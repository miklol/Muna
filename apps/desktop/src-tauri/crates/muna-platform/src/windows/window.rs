//! Window affinities Tauri does not expose (ADR-0002): async positioning, top-most
//! re-assertion, capture exclusion, cursor sampling and the shell's quiet-state query.
//!
//! Handles arrive as [`WindowHandle`] integers from the shell crate and are wrapped into
//! `HWND` here; nothing is dereferenced, so an invalid handle only produces an OS error.

use windows::Win32::Foundation::{GetLastError, HWND, POINT, RECT, SetLastError, WIN32_ERROR};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::Shell::{
    QUNS_APP, QUNS_BUSY, QUNS_NOT_PRESENT, QUNS_PRESENTATION_MODE, QUNS_QUIET_TIME,
    QUNS_RUNNING_D3D_FULL_SCREEN, SHQueryUserNotificationState,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GA_ROOT, GWL_EXSTYLE, GetAncestor, GetCursorPos, GetWindowLongPtrW, GetWindowRect,
    HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, SetWindowDisplayAffinity, SetWindowLongPtrW, SetWindowPos,
    WDA_EXCLUDEFROMCAPTURE, WDA_NONE, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT, WindowFromPoint,
};

use super::monitors::rect_from;
use super::{last_error, os_error};
use crate::error::{PlatformError, PlatformResult};
use crate::types::{Rect, UserNotificationState, WindowHandle};

fn hwnd(window: WindowHandle) -> HWND {
    HWND(window as *mut core::ffi::c_void)
}

pub(super) fn extended_style(window: WindowHandle) -> PlatformResult<u32> {
    // SAFETY: `GetWindowLongPtrW` reads a style value for a handle we do not dereference. A
    // zero return is ambiguous (style 0 or failure), so the last error is cleared first and
    // consulted afterwards, as the API documentation prescribes.
    #[allow(unsafe_code)]
    let style = unsafe {
        SetLastError(WIN32_ERROR(0));
        let style = GetWindowLongPtrW(hwnd(window), GWL_EXSTYLE);
        if style == 0 && GetLastError() != WIN32_ERROR(0) {
            return Err(last_error("GetWindowLongPtrW"));
        }
        style
    };
    Ok(u32::try_from(style & 0xFFFF_FFFF).unwrap_or(u32::MAX))
}

pub(super) fn move_async(window: WindowHandle, rect: Rect) -> PlatformResult<()> {
    let width = i32::try_from(rect.width).unwrap_or(i32::MAX);
    let height = i32::try_from(rect.height).unwrap_or(i32::MAX);
    // SAFETY: plain Win32 call on a handle we own; `SWP_ASYNCWINDOWPOS` posts the request to
    // the window's thread so this never blocks. The BOOL result is surfaced as `Result`.
    #[allow(unsafe_code)]
    unsafe {
        SetWindowPos(
            hwnd(window),
            None,
            rect.x,
            rect.y,
            width,
            height,
            SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| os_error("SetWindowPos", &error))
}

pub(super) fn assert_topmost(window: WindowHandle) -> PlatformResult<()> {
    // SAFETY: as in `move_async`; only the z-order changes (`SWP_NOMOVE | SWP_NOSIZE`).
    #[allow(unsafe_code)]
    unsafe {
        SetWindowPos(
            hwnd(window),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_ASYNCWINDOWPOS | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
    }
    .map_err(|error| os_error("SetWindowPos(HWND_TOPMOST)", &error))
}

pub(super) fn set_tool_window(window: WindowHandle) -> PlatformResult<u32> {
    let current = extended_style(window)?;
    let wanted = (current | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0;
    if wanted == current {
        return Ok(current);
    }
    write_extended_style(window, wanted)?;
    // SAFETY: plain Win32 call on a handle we own; `SWP_FRAMECHANGED` makes the new frame
    // style take effect. The BOOL result is surfaced as `Result`.
    #[allow(unsafe_code)]
    unsafe {
        SetWindowPos(
            hwnd(window),
            None,
            0,
            0,
            0,
            0,
            SWP_ASYNCWINDOWPOS
                | SWP_NOMOVE
                | SWP_NOSIZE
                | SWP_NOZORDER
                | SWP_NOACTIVATE
                | SWP_FRAMECHANGED,
        )
    }
    .map_err(|error| os_error("SetWindowPos(SWP_FRAMECHANGED)", &error))?;
    extended_style(window)
}

pub(super) fn set_click_through(window: WindowHandle, click_through: bool) -> PlatformResult<()> {
    let current = extended_style(window)?;
    // `WS_EX_TRANSPARENT` alone does not pass mouse input for a top-level window; the
    // documented rule ("Layered Windows", hit testing) needs `WS_EX_LAYERED` as well. The
    // M0-E2 spike measured 0/20 pass-throughs without the layered bit.
    let bits = WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0;
    let wanted = if click_through {
        current | bits
    } else {
        current & !bits
    };
    if wanted == current {
        return Ok(());
    }
    // No `SWP_FRAMECHANGED`: neither bit is a frame style, and invalidating the frame on every
    // cursor crossing would repaint the strip.
    write_extended_style(window, wanted)
}

fn write_extended_style(window: WindowHandle, style: u32) -> PlatformResult<()> {
    // Ex-styles never use bit 31, so the widening to `isize` cannot sign-extend.
    let style_ptr = isize::try_from(style).map_err(|_| PlatformError::Os {
        api: "SetWindowLongPtrW",
        code: u32::MAX,
    })?;
    // SAFETY: `SetWindowLongPtrW` writes a style value for a handle we do not dereference.
    // Like the getter, a zero return is ambiguous (previous style 0 or failure), so the last
    // error is cleared first and consulted afterwards.
    #[allow(unsafe_code)]
    unsafe {
        SetLastError(WIN32_ERROR(0));
        let previous = SetWindowLongPtrW(hwnd(window), GWL_EXSTYLE, style_ptr);
        if previous == 0 && GetLastError() != WIN32_ERROR(0) {
            return Err(last_error("SetWindowLongPtrW"));
        }
    }
    Ok(())
}

pub(super) fn set_capture_exclusion(window: WindowHandle, excluded: bool) -> PlatformResult<()> {
    let affinity = if excluded {
        WDA_EXCLUDEFROMCAPTURE
    } else {
        WDA_NONE
    };
    // SAFETY: plain Win32 call on a handle we own; the BOOL result is surfaced as `Result`.
    #[allow(unsafe_code)]
    unsafe { SetWindowDisplayAffinity(hwnd(window), affinity) }
        .map_err(|error| os_error("SetWindowDisplayAffinity", &error))
}

pub(super) fn set_no_activate(window: WindowHandle, no_activate: bool) -> PlatformResult<()> {
    let current = extended_style(window)?;
    let wanted = if no_activate {
        current | WS_EX_NOACTIVATE.0
    } else {
        current & !WS_EX_NOACTIVATE.0
    };
    if wanted == current {
        return Ok(());
    }
    // Not a frame style either (see `set_click_through`), so no `SWP_FRAMECHANGED`.
    write_extended_style(window, wanted)
}

pub(super) fn window_rect(window: WindowHandle) -> PlatformResult<Rect> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid, writable `RECT` for the duration of the call.
    #[allow(unsafe_code)]
    unsafe { GetWindowRect(hwnd(window), &raw mut rect) }
        .map_err(|error| os_error("GetWindowRect", &error))?;
    Ok(rect_from(&rect))
}

pub(super) fn cursor_position() -> PlatformResult<(i32, i32)> {
    let mut point = POINT::default();
    // SAFETY: `point` is a valid, writable `POINT` for the duration of the call.
    #[allow(unsafe_code)]
    unsafe { GetCursorPos(&raw mut point) }.map_err(|error| os_error("GetCursorPos", &error))?;
    Ok((point.x, point.y))
}

/// `true` while the left, right or middle mouse button is held. `GetAsyncKeyState` reports the
/// physical state regardless of which window has focus; the high bit is "currently down".
pub(super) fn pointer_button_down() -> bool {
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].into_iter().any(|key| {
        // SAFETY: pure query of the asynchronous key state for a documented virtual-key code.
        #[allow(unsafe_code)]
        let state = unsafe { GetAsyncKeyState(i32::from(key.0)) };
        state < 0
    })
}

pub(super) fn window_at(x: i32, y: i32) -> WindowHandle {
    // SAFETY: pure queries; a null result means "no window", which is a valid answer.
    #[allow(unsafe_code)]
    let root = unsafe {
        let child = WindowFromPoint(POINT { x, y });
        if child.is_invalid() {
            child
        } else {
            GetAncestor(child, GA_ROOT)
        }
    };
    root.0 as WindowHandle
}

pub(super) fn user_notification_state() -> PlatformResult<UserNotificationState> {
    // SAFETY: no arguments besides the out-value the `windows` crate manages; HRESULT mapped.
    #[allow(unsafe_code)]
    let state = unsafe { SHQueryUserNotificationState() }
        .map_err(|error| os_error("SHQueryUserNotificationState", &error))?;
    Ok(match state {
        QUNS_NOT_PRESENT => UserNotificationState::NotPresent,
        QUNS_BUSY => UserNotificationState::Busy,
        QUNS_RUNNING_D3D_FULL_SCREEN => UserNotificationState::FullscreenD3d,
        QUNS_PRESENTATION_MODE => UserNotificationState::Presentation,
        QUNS_QUIET_TIME => UserNotificationState::QuietTime,
        QUNS_APP => UserNotificationState::App,
        // `QUNS_ACCEPTS_NOTIFICATIONS`, and any state a future Windows build adds: show.
        _ => UserNotificationState::AcceptsNotifications,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Talks to the real OS; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session"
    )]
    fn cursor_and_quiet_state_are_readable() {
        cursor_position().unwrap();
        user_notification_state().unwrap();
    }

    #[test]
    fn invalid_handles_fail_instead_of_panicking() {
        assert!(extended_style(0).is_err());
        assert!(window_rect(0).is_err());
    }
}
