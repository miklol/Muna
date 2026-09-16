//! Reserved-strip mode: a top-edge `AppBar` through `SHAppBarMessage` (docs/modules/notch-shell.md,
//! Placement). The notch window itself is the `AppBar` handle. Only the work-area reservation is
//! used; the OS never positions the window, the shell does (its window is far larger than the
//! strip it reserves). Callback notifications (`ABN_*`) are not handled: the shell re-reserves
//! on every monitor or settings change anyway, and tao's window procedure forwards the unknown
//! message to `DefWindowProc`.

use std::collections::HashSet;

use parking_lot::Mutex;
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::UI::Shell::{
    ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA, SHAppBarMessage,
};
use windows::Win32::UI::WindowsAndMessaging::WM_APP;

use super::monitors::rect_from;
use crate::error::{PlatformError, PlatformResult};
use crate::types::{Rect, WindowHandle};

/// Private message the shell would use for `ABN_*` notifications; unused but required.
const CALLBACK_MESSAGE: u32 = WM_APP + 0x0A5B;

/// Tracks which windows hold a reservation so `reserve_top` knows whether to `ABM_NEW`.
#[derive(Debug, Default)]
pub(super) struct AppBars {
    registered: Mutex<HashSet<WindowHandle>>,
}

impl AppBars {
    pub(super) fn reserve_top(
        &self,
        window: WindowHandle,
        monitor: Rect,
        height: u32,
    ) -> PlatformResult<Rect> {
        let mut registered = self.registered.lock();
        let mut data = data_for(window, monitor, height);
        if !registered.contains(&window) {
            // SAFETY: `data` is a fully initialised `APPBARDATA` with `cbSize` set; the handle is
            // one the shell owns and is not dereferenced here. A zero return means failure.
            #[allow(unsafe_code)]
            if unsafe { SHAppBarMessage(ABM_NEW, &raw mut data) } == 0 {
                return Err(PlatformError::Os {
                    api: "SHAppBarMessage(ABM_NEW)",
                    code: 0,
                });
            }
            registered.insert(window);
        }
        // SAFETY: as above. `ABM_QUERYPOS` adjusts `rc` in place (another AppBar may already
        // occupy the top edge); `ABM_SETPOS` commits it. Neither documents a failure return.
        #[allow(unsafe_code)]
        unsafe {
            SHAppBarMessage(ABM_QUERYPOS, &raw mut data);
            // The query may have moved the rect down; keep the requested height.
            data.rc.bottom = data.rc.top.saturating_add_unsigned(height);
            SHAppBarMessage(ABM_SETPOS, &raw mut data);
        }
        Ok(rect_from(&data.rc))
    }

    pub(super) fn release(&self, window: WindowHandle) {
        let mut registered = self.registered.lock();
        if !registered.remove(&window) {
            return;
        }
        let mut data = data_for(window, Rect::default(), 0);
        // SAFETY: as in `reserve_top`; `ABM_REMOVE` only needs `cbSize` and `hWnd`.
        #[allow(unsafe_code)]
        unsafe {
            SHAppBarMessage(ABM_REMOVE, &raw mut data);
        }
    }
}

fn data_for(window: WindowHandle, monitor: Rect, height: u32) -> APPBARDATA {
    APPBARDATA {
        cbSize: u32::try_from(size_of::<APPBARDATA>()).unwrap_or(u32::MAX),
        hWnd: HWND(window as *mut core::ffi::c_void),
        uCallbackMessage: CALLBACK_MESSAGE,
        uEdge: ABE_TOP,
        rc: RECT {
            left: monitor.x,
            top: monitor.y,
            right: monitor.x.saturating_add_unsigned(monitor.width),
            bottom: monitor.y.saturating_add_unsigned(height),
        },
        lParam: LPARAM(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appbar_data_spans_the_monitor_width_and_the_strip_height() {
        let data = data_for(7, Rect::new(-1920, -291, 1920, 1080), 48);
        assert_eq!(data.uEdge, ABE_TOP);
        assert_eq!(rect_from(&data.rc), Rect::new(-1920, -291, 1920, 48));
        assert_eq!(data.cbSize as usize, size_of::<APPBARDATA>());
    }

    #[test]
    fn releasing_an_unregistered_window_is_a_no_op() {
        let bars = AppBars::default();
        bars.release(12345);
        assert!(bars.registered.lock().is_empty());
    }
}
