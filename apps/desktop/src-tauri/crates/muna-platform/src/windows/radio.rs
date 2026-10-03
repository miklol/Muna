//! The Bluetooth radio (docs/modules/bluetooth.md "Radio toggle" and "Connect/disconnect"):
//! its power state through `Windows.Devices.Radios.Radio`, and dropping one device's link
//! through the radio handle with `IOCTL_BTH_DISCONNECT_DEVICE` (the SDK's `bthioctl.h`).
//!
//! The IOCTL drops the baseband link; Windows tears the profiles (A2DP, HFP, HID) down with it
//! and changes neither the pairing nor the services' enabled state, so the device can connect
//! itself again later. That is what the Settings app's "Disconnect" does, without the
//! persistent `BluetoothSetServiceState` flip the spec marks ⚠️.

use std::mem::size_of;

use parking_lot::Mutex;
use tokio::sync::broadcast;
use tracing::debug;
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Foundation::TypedEventHandler;
use windows::Win32::Devices::Bluetooth::{
    BLUETOOTH_FIND_RADIO_PARAMS, BluetoothFindFirstRadio, BluetoothFindNextRadio,
    BluetoothFindRadioClose,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::IO::DeviceIoControl;
use windows::core::{IInspectable, Ref};

use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;
use crate::types::BluetoothRadioState;

/// `CTL_CODE(FILE_DEVICE_BLUETOOTH, 0x03, METHOD_BUFFERED, FILE_ANY_ACCESS)` from `bthioctl.h`;
/// the input buffer is the device's `BTH_ADDR`. The `windows` crate does not generate it.
pub(super) const IOCTL_BTH_DISCONNECT_DEVICE: u32 = (0x41 << 16) | (0x03 << 2);

/// The Bluetooth radio, looked up on first use and kept for its `StateChanged` event.
#[derive(Debug)]
pub(super) struct RadioWatch {
    events: broadcast::Sender<PlatformEvent>,
    /// The radio and its `StateChanged` token, once found.
    radio: Mutex<Option<(Radio, i64)>>,
}

impl RadioWatch {
    pub(super) fn new(events: broadcast::Sender<PlatformEvent>) -> Self {
        Self {
            events,
            radio: Mutex::new(None),
        }
    }

    pub(super) fn state(&self) -> BluetoothRadioState {
        self.resolve()
            .map_or(BluetoothRadioState::Unavailable, |radio| {
                radio
                    .State()
                    .map_or(BluetoothRadioState::Unavailable, map_state)
            })
    }

    pub(super) fn set(&self, on: bool) -> PlatformResult<()> {
        let radio = self
            .resolve()
            .ok_or(PlatformError::Unsupported("bluetooth radio"))?;
        let access = Radio::RequestAccessAsync()
            .and_then(|operation| operation.join())
            .map_err(|e| os_error("Radio.RequestAccessAsync", &e))?;
        if access != RadioAccessStatus::Allowed {
            return Err(PlatformError::AccessDenied("bluetooth radio"));
        }
        let target = if on { RadioState::On } else { RadioState::Off };
        let status = radio
            .SetStateAsync(target)
            .and_then(|operation| operation.join())
            .map_err(|e| os_error("Radio.SetStateAsync", &e))?;
        match status {
            RadioAccessStatus::Allowed => Ok(()),
            RadioAccessStatus::DeniedByUser | RadioAccessStatus::DeniedBySystem => {
                Err(PlatformError::AccessDenied("bluetooth radio"))
            }
            _ => Err(PlatformError::Unsupported("bluetooth radio toggle")),
        }
    }

    /// The Bluetooth radio, found on the first call. A machine without one is asked again next
    /// time: a USB dongle may have arrived.
    fn resolve(&self) -> Option<Radio> {
        let mut slot = self.radio.lock();
        if let Some((radio, _)) = slot.as_ref() {
            return Some(radio.clone());
        }
        let radio = match find_bluetooth_radio() {
            Ok(Some(radio)) => radio,
            Ok(None) => {
                debug!("no bluetooth radio");
                return None;
            }
            Err(error) => {
                debug!(%error, "Radio.GetRadiosAsync failed");
                return None;
            }
        };
        let handler = {
            let events = self.events.clone();
            TypedEventHandler::<Radio, IInspectable>::new(move |radio: Ref<Radio>, _| {
                let state = radio
                    .ok()?
                    .State()
                    .map_or(BluetoothRadioState::Unavailable, map_state);
                // No subscribers yet is not an error.
                let _ = events.send(PlatformEvent::BluetoothRadioChanged(state));
                Ok(())
            })
        };
        let token = match radio.StateChanged(&handler) {
            Ok(token) => token,
            Err(error) => {
                debug!(%error, "Radio.StateChanged failed; radio changes will not be pushed");
                0
            }
        };
        *slot = Some((radio.clone(), token));
        Some(radio)
    }
}

impl Drop for RadioWatch {
    fn drop(&mut self) {
        if let Some((radio, token)) = self.radio.lock().take()
            && token != 0
            && let Err(error) = radio.RemoveStateChanged(token)
        {
            debug!(%error, "Radio.RemoveStateChanged failed");
        }
    }
}

fn find_bluetooth_radio() -> windows::core::Result<Option<Radio>> {
    let radios = Radio::GetRadiosAsync()?.join()?;
    for radio in &radios {
        if radio.Kind()? == RadioKind::Bluetooth {
            return Ok(Some(radio));
        }
    }
    Ok(None)
}

fn map_state(state: RadioState) -> BluetoothRadioState {
    match state {
        RadioState::On => BluetoothRadioState::On,
        RadioState::Off => BluetoothRadioState::Off,
        // `Disabled` cannot be turned on from here (Device Manager, a policy); `Unknown` is
        // the API declining to say.
        _ => BluetoothRadioState::Unavailable,
    }
}

/// Drops the link to `address` on the first local radio that accepts (a machine normally has
/// one). `Unsupported` without a radio; the IOCTL's own failure otherwise.
pub(super) fn disconnect_address(address: u64) -> PlatformResult<()> {
    let params = BLUETOOTH_FIND_RADIO_PARAMS {
        dwSize: u32::try_from(size_of::<BLUETOOTH_FIND_RADIO_PARAMS>()).unwrap_or(u32::MAX),
    };
    let mut radio = HANDLE::default();
    // SAFETY: `params` is fully initialised with its size set as the API requires, and `radio`
    // is a valid out-pointer for the duration of the call.
    #[allow(unsafe_code)]
    let find = unsafe { BluetoothFindFirstRadio(&raw const params, &raw mut radio) }
        .map_err(|_| PlatformError::Unsupported("bluetooth radio"))?;
    let mut result;
    loop {
        result = disconnect_on(radio, address);
        // SAFETY: `radio` was handed out by the find API and is closed exactly once.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { CloseHandle(radio) } {
            debug!(%error, "CloseHandle(radio) failed");
        }
        if result.is_ok() {
            break;
        }
        // SAFETY: `find` is live until `BluetoothFindRadioClose` below and `radio` is a valid
        // out-pointer.
        #[allow(unsafe_code)]
        if unsafe { BluetoothFindNextRadio(find, &raw mut radio) }.is_err() {
            break;
        }
    }
    // SAFETY: `find` came from `BluetoothFindFirstRadio` and is closed exactly once.
    #[allow(unsafe_code)]
    if let Err(error) = unsafe { BluetoothFindRadioClose(find) } {
        debug!(%error, "BluetoothFindRadioClose failed");
    }
    result
}

fn disconnect_on(radio: HANDLE, address: u64) -> PlatformResult<()> {
    let mut returned = 0u32;
    let size = u32::try_from(size_of::<u64>()).unwrap_or(u32::MAX);
    // SAFETY: `radio` is an open radio handle; the input buffer is the 8-byte `BTH_ADDR` the
    // IOCTL reads and outlives the call; no output buffer is requested and the call is
    // synchronous (no `OVERLAPPED`).
    #[allow(unsafe_code)]
    let result = unsafe {
        DeviceIoControl(
            radio,
            IOCTL_BTH_DISCONNECT_DEVICE,
            Some(std::ptr::from_ref(&address).cast()),
            size,
            None,
            0,
            Some(&raw mut returned),
            None,
        )
    };
    result.map_err(|e| os_error("DeviceIoControl(IOCTL_BTH_DISCONNECT_DEVICE)", &e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_disconnect_ioctl_matches_bthioctl_h() {
        // `FILE_DEVICE_BLUETOOTH` is 0x41; function 3, buffered, any access.
        assert_eq!(IOCTL_BTH_DISCONNECT_DEVICE, 0x0041_000C);
    }

    #[test]
    fn radio_states_map_to_the_three_the_module_knows() {
        assert_eq!(map_state(RadioState::On), BluetoothRadioState::On);
        assert_eq!(map_state(RadioState::Off), BluetoothRadioState::Off);
        assert_eq!(
            map_state(RadioState::Disabled),
            BluetoothRadioState::Unavailable
        );
        assert_eq!(
            map_state(RadioState::Unknown),
            BluetoothRadioState::Unavailable
        );
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn the_radio_reports_a_state_without_panicking() {
        let (events, _) = broadcast::channel(4);
        let watch = RadioWatch::new(events);
        let _ = watch.state();
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn disconnecting_an_unknown_address_fails_cleanly() {
        // No radio is `Unsupported`; a radio refuses an address it has no link to.
        match disconnect_address(0x0000_1234_5678_9ABC) {
            Ok(()) | Err(PlatformError::Unsupported(_) | PlatformError::Os { .. }) => {}
            Err(other) => panic!("unexpected error: {other}"),
        }
    }
}
