//! Placing other applications' windows for Window snap (docs/modules/window-snap.md,
//! docs/04-windows-platform-apis.md "Window snap").
//!
//! Windows 10 and 11 draw a window's sizing border *outside* its visible frame — invisible,
//! about 7 px at 100 % — so `GetWindowRect` is larger than what the user sees while
//! `DWMWA_EXTENDED_FRAME_BOUNDS` is the visible frame. Snapping to a zone by the window rect
//! leaves the "7 px gaps" the acceptance criterion forbids; placing by the frame bounds and
//! adding the insets back is the whole trick.
//!
//! Every call posts to the target rather than waiting for it (`ShowWindowAsync`,
//! `SWP_ASYNCWINDOWPOS`): the target has just finished a drag so it is responsive, but a
//! hung application must never hold a Muna thread.

use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_EXTENDED_FRAME_BOUNDS, DwmGetWindowAttribute};
use windows::Win32::UI::WindowsAndMessaging::{
    GWL_EXSTYLE, GWL_STYLE, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed,
    SW_MAXIMIZE, SW_RESTORE, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOZORDER, SetWindowPos,
    ShowWindowAsync, WS_CAPTION, WS_CHILD, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_THICKFRAME,
};

use super::monitors::rect_from;
use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::types::{Rect, WindowHandle};

fn hwnd(window: WindowHandle) -> HWND {
    HWND(window as *mut core::ffi::c_void)
}

/// Eligibility filter (docs/build-plan/m4-power-tools.md, E3): what the user drags by a title
/// bar and expects to snap. Tool windows (palettes, Muna's own notch) and windows that refuse
/// activation are left alone, as are hidden and child windows.
pub(super) fn is_snappable(window: WindowHandle) -> PlatformResult<bool> {
    if window == 0 {
        return Err(PlatformError::NotFound("window 0".to_owned()));
    }
    // SAFETY: pure style and visibility queries on a handle we never dereference; an invalid
    // handle yields zero styles and "not visible", which reads as "not snappable".
    #[allow(unsafe_code)]
    let (visible, style, ex_style) = unsafe {
        (
            IsWindowVisible(hwnd(window)).as_bool(),
            GetWindowLongPtrW(hwnd(window), GWL_STYLE),
            GetWindowLongPtrW(hwnd(window), GWL_EXSTYLE),
        )
    };
    Ok(visible && snappable_styles(low_bits(style), low_bits(ex_style)))
}

fn low_bits(style: isize) -> u32 {
    u32::try_from(style & 0xFFFF_FFFF).unwrap_or(0)
}

/// The style test behind [`is_snappable`], separable for tests: a top-level window with a
/// caption or a sizing frame, neither a tool window nor one that never activates.
#[must_use]
pub(super) fn snappable_styles(style: u32, ex_style: u32) -> bool {
    let framed = style & WS_CAPTION.0 == WS_CAPTION.0 || style & WS_THICKFRAME.0 != 0;
    let child = style & WS_CHILD.0 != 0;
    let tool = ex_style & WS_EX_TOOLWINDOW.0 != 0 || ex_style & WS_EX_NOACTIVATE.0 != 0;
    framed && !child && !tool
}

pub(super) fn frame_bounds(window: WindowHandle) -> PlatformResult<Rect> {
    let mut frame = RECT::default();
    // SAFETY: `frame` is a valid, writable `RECT` whose size is passed to DWM; when DWM does
    // not answer, the plain window rectangle stands in.
    #[allow(unsafe_code)]
    let dwm = unsafe {
        DwmGetWindowAttribute(
            hwnd(window),
            DWMWA_EXTENDED_FRAME_BOUNDS,
            (&raw mut frame).cast(),
            u32::try_from(size_of::<RECT>()).unwrap_or(u32::MAX),
        )
    };
    if dwm.is_ok() {
        return Ok(rect_from(&frame));
    }
    window_rect(window)
}

fn window_rect(window: WindowHandle) -> PlatformResult<Rect> {
    let mut rect = RECT::default();
    // SAFETY: `rect` is a valid, writable `RECT` for the duration of the call.
    #[allow(unsafe_code)]
    unsafe { GetWindowRect(hwnd(window), &raw mut rect) }
        .map_err(|error| os_error("GetWindowRect", &error))?;
    Ok(rect_from(&rect))
}

/// How far the window rectangle extends past the visible frame on each side; all zero when
/// the two agree (a borderless window, or DWM off).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(super) struct FrameInsets {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl FrameInsets {
    /// The window rectangle that puts the visible frame exactly on `target`.
    #[must_use]
    pub fn outer_for(self, target: Rect) -> Rect {
        Rect::new(
            target.x.saturating_sub(self.left),
            target.y.saturating_sub(self.top),
            target
                .width
                .saturating_add_signed(self.left.saturating_add(self.right)),
            target
                .height
                .saturating_add_signed(self.top.saturating_add(self.bottom)),
        )
    }
}

/// Insets from a window rectangle and the visible frame inside it. A frame that is not inside
/// the rectangle (a maximised window pushes its borders off-screen; a stale answer) counts as
/// no inset on that side rather than a negative one.
#[must_use]
pub(super) fn insets(outer: Rect, frame: Rect) -> FrameInsets {
    let right = outer
        .x
        .saturating_add_unsigned(outer.width)
        .saturating_sub(frame.x.saturating_add_unsigned(frame.width));
    let bottom = outer
        .y
        .saturating_add_unsigned(outer.height)
        .saturating_sub(frame.y.saturating_add_unsigned(frame.height));
    FrameInsets {
        left: frame.x.saturating_sub(outer.x).max(0),
        top: frame.y.saturating_sub(outer.y).max(0),
        right: right.max(0),
        bottom: bottom.max(0),
    }
}

pub(super) fn place(window: WindowHandle, target: Rect) -> PlatformResult<()> {
    restore_if_needed(window)?;
    let outer = window_rect(window)?;
    let frame = frame_bounds(window)?;
    let rect = insets(outer, frame).outer_for(target);
    set_window_pos(window, rect)
}

pub(super) fn maximize(window: WindowHandle, work_area: Rect) -> PlatformResult<()> {
    restore_if_needed(window)?;
    // A window maximises on the monitor holding most of it: put it there first.
    let frame = frame_bounds(window)?;
    if !work_area.contains(
        frame.x.saturating_add_unsigned(frame.width / 2),
        frame.y.saturating_add_unsigned(frame.height / 2),
    ) {
        set_window_pos(window, work_area)?;
    }
    // SAFETY: `ShowWindowAsync` posts `WM_SYSCOMMAND`-equivalent work to the window's thread;
    // a false return only means the window was hidden before, which is not an error here.
    #[allow(unsafe_code)]
    unsafe {
        let _ = ShowWindowAsync(hwnd(window), SW_MAXIMIZE);
    }
    Ok(())
}

/// A maximised or minimised window ignores `SetWindowPos`; restore it first. Aero Snap may
/// have maximised the window at the very end of the drag Muna is answering, so this is the
/// common case for the *Maximize*-adjacent zones near the top edge.
fn restore_if_needed(window: WindowHandle) -> PlatformResult<()> {
    // SAFETY: pure state queries on a handle we never dereference.
    #[allow(unsafe_code)]
    let needs_restore =
        unsafe { IsZoomed(hwnd(window)).as_bool() || IsIconic(hwnd(window)).as_bool() };
    if !needs_restore {
        return Ok(());
    }
    // SAFETY: `ShowWindowAsync` posts the request to the window's own thread; it returns false
    // only when the window's thread has no message queue (the window is gone).
    #[allow(unsafe_code)]
    let posted = unsafe { ShowWindowAsync(hwnd(window), SW_RESTORE).as_bool() };
    if posted {
        Ok(())
    } else {
        Err(PlatformError::NotFound(format!("window {window}")))
    }
}

fn set_window_pos(window: WindowHandle, rect: Rect) -> PlatformResult<()> {
    let width = i32::try_from(rect.width).unwrap_or(i32::MAX);
    let height = i32::try_from(rect.height).unwrap_or(i32::MAX);
    // SAFETY: plain Win32 call on a handle we do not dereference; `SWP_ASYNCWINDOWPOS` posts
    // the request to the window's thread so this never blocks. The BOOL result is surfaced.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn insets_are_the_invisible_border_on_each_side() {
        // A 100 % window: 7 px sizing borders left, right and bottom, none on top.
        let outer = Rect::new(93, 100, 814, 607);
        let frame = Rect::new(100, 100, 800, 600);
        let insets = insets(outer, frame);
        assert_eq!(
            insets,
            FrameInsets {
                left: 7,
                top: 0,
                right: 7,
                bottom: 7
            }
        );
        let target = Rect::new(0, 0, 1280, 1392);
        assert_eq!(insets.outer_for(target), Rect::new(-7, 0, 1294, 1399));
    }

    #[test]
    fn a_borderless_window_has_no_insets() {
        let rect = Rect::new(10, 20, 300, 200);
        assert_eq!(insets(rect, rect), FrameInsets::default());
        assert_eq!(insets(rect, rect).outer_for(rect), rect);
    }

    #[test]
    fn a_frame_outside_the_rectangle_never_yields_negative_insets() {
        let outer = Rect::new(0, 0, 100, 100);
        let frame = Rect::new(-5, -5, 120, 120);
        assert_eq!(insets(outer, frame), FrameInsets::default());
    }

    #[test]
    fn only_framed_top_level_windows_snap() {
        let overlapped = WS_CAPTION.0 | WS_THICKFRAME.0;
        assert!(snappable_styles(overlapped, 0));
        assert!(snappable_styles(WS_THICKFRAME.0, 0));
        assert!(snappable_styles(WS_CAPTION.0, 0));
        assert!(!snappable_styles(0, 0));
        assert!(!snappable_styles(overlapped | WS_CHILD.0, 0));
        assert!(!snappable_styles(overlapped, WS_EX_TOOLWINDOW.0));
        assert!(!snappable_styles(overlapped, WS_EX_NOACTIVATE.0));
    }

    #[test]
    fn an_invalid_handle_is_not_snappable() {
        assert_eq!(
            is_snappable(0),
            Err(PlatformError::NotFound("window 0".to_owned()))
        );
        assert!(!is_snappable(0x1).unwrap());
    }
}
