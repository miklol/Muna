//! Snapshot of a top-level window for the yield rules (docs/modules/notch-shell.md): title,
//! process image name, DWM frame bounds and the PILLAR fullscreen heuristic.

use windows::Win32::Foundation::{CloseHandle, HWND, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromWindow,
};
use windows::Win32::System::Threading::{
    OpenProcess, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_STYLE, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, GetWindowTextW,
    GetWindowThreadProcessId, WS_CAPTION, WS_POPUP,
};
use windows::core::PWSTR;

use super::monitors::rect_from;
use crate::types::{ForegroundWindow, Rect};

/// Fraction of the monitor a window must cover to count as fullscreen (PILLAR heuristic).
const FULLSCREEN_COVERAGE: f64 = 0.9;

pub(super) fn current() -> Option<ForegroundWindow> {
    // SAFETY: no arguments; a null handle means "no foreground window" and is handled.
    #[allow(unsafe_code)]
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    Some(snapshot(hwnd))
}

pub(super) fn snapshot(hwnd: HWND) -> ForegroundWindow {
    let bounds = frame_bounds(hwnd);
    ForegroundWindow {
        title: title(hwnd),
        process_name: process_name(hwnd),
        bounds,
        is_fullscreen: is_fullscreen(hwnd, bounds),
    }
}

fn title(hwnd: HWND) -> String {
    let mut buffer = [0_u16; 256];
    // SAFETY: `buffer` is a valid, writable UTF-16 buffer and its length is passed along.
    #[allow(unsafe_code)]
    let len = unsafe { GetWindowTextW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0).min(buffer.len())])
}

fn process_name(hwnd: HWND) -> String {
    let mut pid = 0_u32;
    // SAFETY: `pid` is a valid, writable `u32`; a zero return means the window is gone.
    #[allow(unsafe_code)]
    let thread = unsafe { GetWindowThreadProcessId(hwnd, Some(&raw mut pid)) };
    if thread == 0 || pid == 0 {
        return String::new();
    }
    // SAFETY: the process handle is opened with the least privilege that
    // `QueryFullProcessImageNameW` accepts and is closed before returning on every path.
    #[allow(unsafe_code)]
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buffer = [0_u16; 1024];
        let mut len = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
        let result = QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_WIN32,
            PWSTR(buffer.as_mut_ptr()),
            &raw mut len,
        );
        // Best effort: a failed close cannot be acted upon and must not mask the name.
        let _ = CloseHandle(process);
        if result.is_err() {
            return String::new();
        }
        let path = String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0)]);
        path.rsplit(['\\', '/']).next().unwrap_or("").to_owned()
    }
}

fn frame_bounds(hwnd: HWND) -> Rect {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid, writable `RECT` and its size is passed to DWM; when DWM is
    // unavailable the plain window rectangle is used instead.
    #[allow(unsafe_code)]
    let ok = unsafe {
        DwmGetWindowAttribute(
            hwnd,
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut rect).cast(),
            u32::try_from(size_of::<RECT>()).unwrap_or(u32::MAX),
        )
        .is_ok()
            || GetWindowRect(hwnd, &raw mut rect).is_ok()
    };
    if ok {
        rect_from(&rect)
    } else {
        Rect::default()
    }
}

fn is_fullscreen(hwnd: HWND, bounds: Rect) -> bool {
    let mut info = MONITORINFO {
        cbSize: u32::try_from(size_of::<MONITORINFO>()).unwrap_or(u32::MAX),
        ..Default::default()
    };
    // SAFETY: `info` has `cbSize` set as `GetMonitorInfoW` requires; the monitor handle comes
    // straight from `MonitorFromWindow` with a fallback so it is never null.
    #[allow(unsafe_code)]
    let (ok, style) = unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        (
            GetMonitorInfoW(monitor, &raw mut info).as_bool(),
            GetWindowLongPtrW(hwnd, GWL_STYLE),
        )
    };
    if !ok {
        return false;
    }
    let monitor = rect_from(&info.rcMonitor);
    covers(bounds, monitor) && borderless(style)
}

/// `true` when `window` covers at least [`FULLSCREEN_COVERAGE`] of `monitor`.
fn covers(window: Rect, monitor: Rect) -> bool {
    let overlap_w = (window.x.saturating_add_unsigned(window.width))
        .min(monitor.x.saturating_add_unsigned(monitor.width))
        .saturating_sub(window.x.max(monitor.x))
        .max(0);
    let overlap_h = (window.y.saturating_add_unsigned(window.height))
        .min(monitor.y.saturating_add_unsigned(monitor.height))
        .saturating_sub(window.y.max(monitor.y))
        .max(0);
    let overlap = f64::from(overlap_w) * f64::from(overlap_h);
    let area = f64::from(monitor.width) * f64::from(monitor.height);
    area > 0.0 && overlap / area >= FULLSCREEN_COVERAGE
}

/// A borderless (`WS_POPUP`) or caption-less window: games and video players. A maximised
/// browser keeps `WS_CAPTION` and therefore only triggers *Peek*, never *hide*.
fn borderless(style: isize) -> bool {
    let style = u32::try_from(style & 0xFFFF_FFFF).unwrap_or(0);
    style & WS_POPUP.0 != 0 || style & WS_CAPTION.0 != WS_CAPTION.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coverage_uses_the_overlap_with_the_monitor() {
        let monitor = Rect::new(0, 0, 2560, 1440);
        assert!(covers(Rect::new(0, 0, 2560, 1440), monitor));
        assert!(covers(Rect::new(-8, -8, 2576, 1456), monitor));
        assert!(!covers(Rect::new(0, 0, 1280, 1440), monitor));
        assert!(!covers(
            Rect::new(0, 0, 2560, 1440),
            Rect::new(-1920, 0, 1920, 1080)
        ));
    }

    #[test]
    fn caption_windows_are_not_fullscreen_even_when_maximised() {
        let overlapped_with_caption = isize::try_from(WS_CAPTION.0).unwrap();
        assert!(!borderless(overlapped_with_caption));
        assert!(borderless(isize::try_from(WS_POPUP.0).unwrap()));
        assert!(borderless(0));
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn snapshot_of_the_foreground_window_has_bounds() {
        if let Some(window) = current() {
            assert!(window.bounds.width > 0);
        }
    }
}
