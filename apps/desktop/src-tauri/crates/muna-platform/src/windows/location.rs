//! `Windows.Devices.Geolocation` for the weather module (docs/modules/weather.md,
//! docs/04-windows-platform-apis.md "Devices & power").
//!
//! One fix per call: `Geolocator.RequestAccessAsync` answers from the Settings → Privacy →
//! Location switches (a desktop app without package identity never sees a prompt; a packaged
//! one is prompted on its first call), then `GetGeopositionAsync` waits for a position — with a
//! timeout, because a machine whose only source is Wi-Fi positioning can report `Ready` and
//! still never produce a fix.
//!
//! Both calls run on a short-lived thread of their own that initialises a COM apartment first.
//! Measured on Win11: on a thread without one (a tokio blocking thread, say — the implicit MTA
//! the `windows` crate falls back to is not enough) the `RequestAccessAsync` completion never
//! fires and a `join` hangs forever; with `CoInitializeEx(COINIT_MULTITHREADED)` it answers in
//! about 12 ms. One thread per quarter hour costs nothing.
//!
//! Every wait here has a deadline. `IAsyncOperation::join` has none, and the location broker
//! was once seen (under heavy load, right after a client of it had been killed) not answering
//! `RequestAccessAsync` for a quarter of an hour — the weather service must get a failure it can
//! retry, never sit at "finding your location". A wait that runs out cancels the operation and
//! reports `ERROR_TIMEOUT`; should the broker not even answer the cancel, the worker thread is
//! left behind rather than waited for, and the next refresh starts a fresh one.

use std::sync::mpsc;
use std::time::Duration;

use windows::Devices::Geolocation::{
    GeolocationAccessStatus, Geolocator, PositionAccuracy, PositionStatus,
};
use windows::Foundation::TimeSpan;
use windows::Win32::Foundation::ERROR_TIMEOUT;
use windows::Win32::System::Com::{COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize};
use windows::core::HRESULT;

use super::os_error;
use super::winrt::join_within;
use crate::error::{PlatformError, PlatformResult};
use crate::types::GeoPosition;

/// `E_ACCESSDENIED`: what `GetGeopositionAsync` raises when location is switched off between
/// the access check and the fix.
const E_ACCESSDENIED: HRESULT = HRESULT(0x8007_0005_u32.cast_signed());

/// One `TimeSpan` tick is 100 ns.
const TICKS_PER_SECOND: i64 = 10_000_000;

/// A fix this old still answers "what is the weather here": the forecast refreshes every
/// quarter hour, and a cached position is answered without powering a radio.
const MAXIMUM_AGE: TimeSpan = TimeSpan {
    Duration: 15 * 60 * TICKS_PER_SECOND,
};

/// How long to wait for a fresh fix before reporting a transient failure (the weather service
/// retries with backoff). Wi-Fi positioning answers in seconds when it answers at all.
const TIMEOUT: TimeSpan = TimeSpan {
    Duration: 30 * TICKS_PER_SECOND,
};

/// The access check may wait on the packaged consent prompt, so this is generous; the answer is
/// remembered by Windows, and the weather service retries in a minute anyway.
const ACCESS_WAIT: Duration = Duration::from_secs(60);

/// `TIMEOUT` plus slack for the broker's own bookkeeping.
const FIX_WAIT: Duration = Duration::from_secs(40);

/// Both waits, the COM setup and a margin: the most `position()` ever takes.
const THREAD_WAIT: Duration = Duration::from_secs(110);

/// One fix, or why Windows will not give one (see the module docs for the threading).
pub(super) fn position() -> PlatformResult<GeoPosition> {
    let (answer, answered) = mpsc::channel();
    std::thread::Builder::new()
        .name("muna-platform-location".into())
        .spawn(move || {
            // The receiver is gone once `THREAD_WAIT` runs out; a late answer has nowhere to go.
            let _ = answer.send(position_with_apartment());
        })
        .map_err(|_| PlatformError::Unsupported("location thread"))?;
    answered
        .recv_timeout(THREAD_WAIT)
        .unwrap_or(Err(PlatformError::Os {
            api: "Geolocator",
            code: ERROR_TIMEOUT.to_hresult().0.cast_unsigned(),
        }))
}

fn position_with_apartment() -> PlatformResult<GeoPosition> {
    // SAFETY: initialising COM on this dedicated thread has no preconditions; the matching
    // `CoUninitialize` runs before the thread ends. `S_FALSE` (already initialised) is fine too.
    #[allow(unsafe_code)]
    unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
        .ok()
        .map_err(|e| os_error("CoInitializeEx", &e))?;
    let fix = position_on_com_thread();
    // SAFETY: balances the successful `CoInitializeEx` above on the same thread.
    #[allow(unsafe_code)]
    unsafe {
        CoUninitialize();
    }
    fix
}

fn position_on_com_thread() -> PlatformResult<GeoPosition> {
    let access = Geolocator::RequestAccessAsync()
        .and_then(|operation| join_within(&operation, ACCESS_WAIT))
        .map_err(|e| os_error("Geolocator.RequestAccessAsync", &e))?;
    match access {
        GeolocationAccessStatus::Allowed => {}
        GeolocationAccessStatus::Denied => return Err(PlatformError::AccessDenied("location")),
        _ => return Err(PlatformError::Unsupported("location")),
    }
    let locator = Geolocator::new().map_err(|e| os_error("Geolocator", &e))?;
    // A forecast is per square kilometre; a coarse fix answers faster and asks less of the
    // machine than a GPS-grade one.
    locator
        .SetDesiredAccuracy(PositionAccuracy::Default)
        .map_err(|e| os_error("Geolocator.SetDesiredAccuracy", &e))?;
    match locator.LocationStatus() {
        Ok(PositionStatus::Disabled) => return Err(PlatformError::AccessDenied("location")),
        Ok(PositionStatus::NotAvailable) => return Err(PlatformError::Unsupported("location")),
        Ok(_) | Err(_) => {}
    }
    let fix = locator
        .GetGeopositionAsyncWithAgeAndTimeout(MAXIMUM_AGE, TIMEOUT)
        .and_then(|operation| join_within(&operation, FIX_WAIT))
        .map_err(|e| {
            if e.code() == E_ACCESSDENIED {
                PlatformError::AccessDenied("location")
            } else {
                // Includes `ERROR_TIMEOUT` from either deadline: no fix in time is a transient
                // failure the weather service retries with backoff, never a hang.
                os_error("Geolocator.GetGeopositionAsync", &e)
            }
        })?;
    let coordinate = fix
        .Coordinate()
        .map_err(|e| os_error("Geoposition.Coordinate", &e))?;
    let point = coordinate
        .Point()
        .and_then(|point| point.Position())
        .map_err(|e| os_error("Geocoordinate.Point", &e))?;
    Ok(GeoPosition {
        latitude: point.Latitude,
        longitude: point.Longitude,
        accuracy_m: coordinate.Accuracy().ok(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_denied_hresult_is_the_win32_code() {
        assert_eq!(E_ACCESSDENIED.0.cast_unsigned(), 0x8007_0005);
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine. Bounded by `THREAD_WAIT`
    /// however the broker behaves, so a machine with no usable source still finishes. Expect the
    /// full `ACCESS_WAIT` on the first run of a freshly linked binary: the access broker was seen
    /// never answering a just-written executable, and answering the same one in 10 ms from then on.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn position_answers_or_says_why_not() {
        match position() {
            Ok(fix) => {
                assert!((-90.0..=90.0).contains(&fix.latitude));
                assert!((-180.0..=180.0).contains(&fix.longitude));
            }
            Err(
                PlatformError::AccessDenied(_)
                | PlatformError::Unsupported(_)
                | PlatformError::Os { .. },
            ) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
    }
}
