//! A dedicated message-pump thread that turns two OS broadcasts into [`PlatformEvent`]s:
//!
//! * `WM_DISPLAYCHANGE` → [`PlatformEvent::MonitorsChanged`] (resolution, scale, hot-plug), and
//! * `EVENT_SYSTEM_FOREGROUND` via `SetWinEventHook` → [`PlatformEvent::ForegroundChanged`].
//!
//! A hidden *top-level* window is used on purpose: message-only (`HWND_MESSAGE`) windows do not
//! receive broadcast messages such as `WM_DISPLAYCHANGE`. The `WinEvent` hook must live on a
//! thread with a message loop, which is why both share this pump. Nothing here touches the
//! Tauri/tao windows or their threads.

use std::cell::RefCell;
use std::sync::mpsc;
use std::thread::JoinHandle;

use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Win32::Foundation::{
    ERROR_CLASS_ALREADY_EXISTS, GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    CHILDID_SELF, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    EVENT_SYSTEM_FOREGROUND, GetMessageW, MSG, OBJID_WINDOW, PostMessageW, PostQuitMessage,
    RegisterClassW, TranslateMessage, WINDOW_EX_STYLE, WINEVENT_OUTOFCONTEXT,
    WINEVENT_SKIPOWNPROCESS, WM_CLOSE, WM_DESTROY, WM_DISPLAYCHANGE, WNDCLASSW, WS_OVERLAPPED,
};
use windows::core::{PCWSTR, w};

use super::{foreground, last_error, monitors};
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;

const CLASS_NAME: PCWSTR = w!("MunaPlatformPump");

thread_local! {
    /// The pump thread's event sender, reachable from the `extern "system"` callbacks.
    static SENDER: RefCell<Option<broadcast::Sender<PlatformEvent>>> = const { RefCell::new(None) };
}

/// Owns the pump thread; dropping it closes the hidden window and joins the thread.
#[derive(Debug)]
pub(super) struct Pump {
    window: isize,
    thread: Option<JoinHandle<()>>,
}

impl Pump {
    /// Starts the pump and waits until the hidden window exists (or creation failed).
    pub(super) fn start(events: broadcast::Sender<PlatformEvent>) -> PlatformResult<Self> {
        let (ready_tx, ready_rx) = mpsc::channel::<PlatformResult<isize>>();
        let thread = std::thread::Builder::new()
            .name("muna-platform-pump".into())
            .spawn(move || run(events, &ready_tx))
            .map_err(|_| PlatformError::Unsupported("platform pump thread"))?;
        let window = ready_rx
            .recv()
            .map_err(|_| PlatformError::Unsupported("platform pump thread exited early"))??;
        Ok(Self {
            window,
            thread: Some(thread),
        })
    }
}

impl Drop for Pump {
    fn drop(&mut self) {
        let hwnd = HWND(self.window as *mut core::ffi::c_void);
        // SAFETY: `PostMessageW` only queues a message for the pump thread; the handle belongs
        // to a window this struct created and destroys in its own `WM_CLOSE` handler.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) } {
            warn!(%error, "platform pump: WM_CLOSE could not be posted");
        }
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            warn!("platform pump thread panicked");
        }
    }
}

fn run(events: broadcast::Sender<PlatformEvent>, ready: &mpsc::Sender<PlatformResult<isize>>) {
    SENDER.with(|sender| *sender.borrow_mut() = Some(events));

    let window = match create_window() {
        Ok(window) => window,
        Err(error) => {
            // A closed receiver only means the caller gave up waiting; nothing left to do.
            let _ = ready.send(Err(error));
            return;
        }
    };
    let hook = install_foreground_hook();
    // SAFETY: plain handle-to-integer conversion; the handle is not dereferenced.
    let _ = ready.send(Ok(window.0 as isize));

    let mut message = MSG::default();
    // SAFETY: standard Win32 message loop: `message` is a valid `MSG` for every call and the
    // loop ends when `GetMessageW` reports `WM_QUIT` (0) or an error (-1).
    #[allow(unsafe_code)]
    unsafe {
        while GetMessageW(&raw mut message, None, 0, 0).as_bool() {
            // TranslateMessage's return value only says whether a character was produced.
            let _ = TranslateMessage(&raw const message);
            DispatchMessageW(&raw const message);
        }
        if let Some(hook) = hook
            && !UnhookWinEvent(hook).as_bool()
        {
            warn!("platform pump: UnhookWinEvent failed");
        }
    }
    SENDER.with(|sender| sender.borrow_mut().take());
    debug!("platform pump stopped");
}

fn create_window() -> PlatformResult<HWND> {
    // SAFETY: every call below is a documented Win32 registration/creation call with valid
    // pointers to `'static` or stack data that outlives the call; every result is checked.
    #[allow(unsafe_code)]
    unsafe {
        let module =
            GetModuleHandleW(None).map_err(|error| super::os_error("GetModuleHandleW", &error))?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: HINSTANCE(module.0),
            lpszClassName: CLASS_NAME,
            ..Default::default()
        };
        if RegisterClassW(&raw const class) == 0 && GetLastError() != ERROR_CLASS_ALREADY_EXISTS {
            return Err(last_error("RegisterClassW"));
        }
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            CLASS_NAME,
            w!("Muna platform pump"),
            WS_OVERLAPPED,
            0,
            0,
            0,
            0,
            None,
            None,
            Some(HINSTANCE(module.0)),
            None,
        )
        .map_err(|error| super::os_error("CreateWindowExW", &error))
    }
}

fn install_foreground_hook() -> Option<HWINEVENTHOOK> {
    // SAFETY: out-of-context hooks deliver events through this thread's message loop; the
    // callback is an `extern "system"` fn with the documented signature.
    #[allow(unsafe_code)]
    let hook = unsafe {
        SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            None,
            Some(foreground_proc),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if hook.is_invalid() {
        warn!(
            "platform pump: SetWinEventHook(EVENT_SYSTEM_FOREGROUND) failed; foreground events disabled"
        );
        return None;
    }
    Some(hook)
}

fn publish(event: PlatformEvent) {
    SENDER.with(|sender| {
        if let Some(sender) = sender.borrow().as_ref() {
            // No subscribers is fine: the shell may not be listening yet.
            let _ = sender.send(event);
        }
    });
}

#[allow(unsafe_code)]
unsafe extern "system" fn window_proc(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    match message {
        WM_DISPLAYCHANGE => {
            match monitors::enumerate() {
                Ok(monitors) => publish(PlatformEvent::MonitorsChanged(monitors)),
                Err(error) => warn!(%error, "platform pump: monitor enumeration failed"),
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            // SAFETY: `hwnd` is the pump window handed to us by the OS for this message.
            if unsafe { DestroyWindow(hwnd) }.is_err() {
                warn!("platform pump: DestroyWindow failed");
            }
            LRESULT(0)
        }
        WM_DESTROY => {
            // SAFETY: posting WM_QUIT to the current thread has no preconditions.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        // SAFETY: forwarding the exact arguments the OS gave us.
        _ => unsafe { DefWindowProcW(hwnd, message, wparam, lparam) },
    }
}

#[allow(unsafe_code)]
unsafe extern "system" fn foreground_proc(
    _hook: HWINEVENTHOOK,
    _event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    if id_object != OBJID_WINDOW.0 || id_child != CHILDID_SELF.cast_signed() || hwnd.is_invalid() {
        return;
    }
    publish(PlatformEvent::ForegroundChanged(foreground::snapshot(hwnd)));
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
    fn pump_starts_and_stops_cleanly() {
        let (events, _rx) = broadcast::channel(8);
        let pump = Pump::start(events).unwrap();
        assert_ne!(pump.window, 0);
        drop(pump);
    }
}
