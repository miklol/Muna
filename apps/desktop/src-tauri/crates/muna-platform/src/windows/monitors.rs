//! `EnumDisplayMonitors` + `GetMonitorInfoW` + `GetDpiForMonitor` (docs/modules/notch-shell.md,
//! Placement). Physical pixels throughout; the shell converts to logical units per monitor.

use windows::Win32::Foundation::{LPARAM, RECT};
use windows::Win32::Graphics::Gdi::{
    EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW,
};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::MONITORINFOF_PRIMARY;
use windows::core::BOOL;

use super::{last_error, os_error};
use crate::error::PlatformResult;
use crate::types::{MonitorInfo, Rect};

pub(super) fn enumerate() -> PlatformResult<Vec<MonitorInfo>> {
    let mut handles: Vec<HMONITOR> = Vec::new();
    // SAFETY: `collect` only dereferences `lparam` as the `Vec<HMONITOR>` passed right here,
    // and `EnumDisplayMonitors` invokes it synchronously on this thread before returning, so
    // the vector outlives every callback. The result is checked below.
    #[allow(unsafe_code)]
    let ok = unsafe {
        EnumDisplayMonitors(
            None,
            None,
            Some(collect),
            LPARAM((&raw mut handles) as isize),
        )
    };
    if !ok.as_bool() {
        return Err(last_error("EnumDisplayMonitors"));
    }
    handles.into_iter().map(describe).collect()
}

#[allow(unsafe_code)]
unsafe extern "system" fn collect(
    monitor: HMONITOR,
    _hdc: HDC,
    _clip: *mut RECT,
    lparam: LPARAM,
) -> BOOL {
    // SAFETY: see `enumerate`; `lparam` is the address of its live `Vec<HMONITOR>`.
    let handles = unsafe { &mut *(lparam.0 as *mut Vec<HMONITOR>) };
    handles.push(monitor);
    BOOL(1)
}

fn describe(monitor: HMONITOR) -> PlatformResult<MonitorInfo> {
    let mut info = MONITORINFOEXW {
        monitorInfo: MONITORINFO {
            cbSize: u32::try_from(size_of::<MONITORINFOEXW>()).unwrap_or(u32::MAX),
            ..Default::default()
        },
        ..Default::default()
    };
    // SAFETY: `info` is a valid `MONITORINFOEXW` with `cbSize` set, which is what
    // `GetMonitorInfoW` requires when handed a `MONITORINFO` pointer. The result is checked.
    #[allow(unsafe_code)]
    let ok = unsafe { GetMonitorInfoW(monitor, (&raw mut info).cast::<MONITORINFO>()) };
    if !ok.as_bool() {
        return Err(last_error("GetMonitorInfoW"));
    }

    let (mut dpi_x, mut dpi_y) = (0_u32, 0_u32);
    // SAFETY: both out-pointers are valid `u32`s for the duration of the call; the HRESULT is
    // surfaced as `Result` by the `windows` crate and mapped below.
    #[allow(unsafe_code)]
    unsafe { GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &raw mut dpi_x, &raw mut dpi_y) }
        .map_err(|error| os_error("GetDpiForMonitor", &error))?;

    let name_len = info
        .szDevice
        .iter()
        .position(|&c| c == 0)
        .unwrap_or(info.szDevice.len());
    Ok(MonitorInfo {
        id: String::from_utf16_lossy(&info.szDevice[..name_len]),
        bounds: rect_from(&info.monitorInfo.rcMonitor),
        work_area: rect_from(&info.monitorInfo.rcWork),
        dpi: dpi_x.max(dpi_y),
        is_primary: info.monitorInfo.dwFlags & MONITORINFOF_PRIMARY != 0,
    })
}

pub(super) fn rect_from(rect: &RECT) -> Rect {
    Rect::new(
        rect.left,
        rect.top,
        rect.right.saturating_sub(rect.left).unsigned_abs(),
        rect.bottom.saturating_sub(rect.top).unsigned_abs(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_conversion_handles_negative_origins() {
        let rect = RECT {
            left: -1920,
            top: -291,
            right: 0,
            bottom: 789,
        };
        assert_eq!(rect_from(&rect), Rect::new(-1920, -291, 1920, 1080));
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn enumerates_at_least_one_monitor_with_a_primary() {
        let monitors = enumerate().unwrap();
        assert!(!monitors.is_empty());
        assert_eq!(monitors.iter().filter(|m| m.is_primary).count(), 1);
        assert!(monitors.iter().all(|m| m.dpi >= 96));
    }
}
