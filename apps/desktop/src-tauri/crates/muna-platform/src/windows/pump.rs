//! A dedicated message-pump thread that turns OS broadcasts into [`PlatformEvent`]s:
//!
//! * `WM_DISPLAYCHANGE` → [`PlatformEvent::MonitorsChanged`] (resolution, scale, hot-plug),
//! * `EVENT_SYSTEM_FOREGROUND` via `SetWinEventHook` → [`PlatformEvent::ForegroundChanged`],
//! * `EVENT_SYSTEM_MOVESIZESTART/END` via `SetWinEventHook` → [`PlatformEvent::MoveSizeChanged`],
//! * `WM_WTSSESSION_CHANGE` (after `WTSRegisterSessionNotification`) →
//!   [`PlatformEvent::SessionLockChanged`],
//! * `WM_POWERBROADCAST` / `PBT_APMPOWERSTATUSCHANGE` → [`PlatformEvent::BatteryChanged`]
//!   (re-read with `GetSystemPowerStatus`; the OS repeats it, consumers de-duplicate).
//!
//! A hidden *top-level* window is used on purpose: message-only (`HWND_MESSAGE`) windows do not
//! receive broadcast messages such as `WM_DISPLAYCHANGE`. The `WinEvent` hooks must live on a
//! thread with a message loop, which is why everything shares this pump. Nothing here touches
//! the Tauri/tao windows or their threads.

use std::cell::{Cell, RefCell};
use std::fmt;
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tokio::sync::broadcast;
use tracing::{debug, warn};
use windows::Win32::Foundation::{
    ERROR_CLASS_ALREADY_EXISTS, GetLastError, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::RemoteDesktop::{
    NOTIFY_FOR_THIS_SESSION, WTSRegisterSessionNotification, WTSUnRegisterSessionNotification,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    CHILDID_SELF, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW,
    EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZESTART, GetMessageW,
    MSG, OBJID_WINDOW, PBT_APMPOWERSTATUSCHANGE, PostMessageW, PostQuitMessage, RegisterClassW,
    TranslateMessage, WINDOW_EX_STYLE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_CLOSE,
    WM_DESTROY, WM_DISPLAYCHANGE, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW,
    WS_OVERLAPPED, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
};
use windows::core::{PCWSTR, w};

use super::{foreground, last_error, monitors, power};
use crate::error::{PlatformError, PlatformResult};
use crate::events::PlatformEvent;

const CLASS_NAME: PCWSTR = w!("MunaPlatformPump");

/// How long stopping the pump may take: the product's expectation for shutdown.
pub(super) const STOP_BUDGET: Duration = Duration::from_millis(500);

thread_local! {
    /// The pump thread's event sender, reachable from the `extern "system"` callbacks.
    static SENDER: RefCell<Option<broadcast::Sender<PlatformEvent>>> = const { RefCell::new(None) };
    /// When each shutdown step finished on the pump thread, handed back through the join.
    static MARKS: Cell<Marks> = Cell::new(Marks::default());
}

/// Owns the pump thread; dropping it closes the hidden window and joins the thread.
#[derive(Debug)]
pub(super) struct Pump {
    window: isize,
    thread: Option<JoinHandle<Marks>>,
}

/// The instants the pump thread passed while shutting down, plus its last few `WinEvent`
/// callbacks so a stop can tell whether one of them held up `WM_CLOSE`.
#[derive(Clone, Copy, Debug, Default)]
struct Marks {
    close: Option<Instant>,
    quit_posted: Option<Instant>,
    destroyed: Option<Instant>,
    loop_left: Option<Instant>,
    unhooked: [Option<Instant>; 2],
    unregistered: Option<Instant>,
    returned: Option<Instant>,
    callbacks: [Option<(Instant, Instant)>; 4],
    next_callback: usize,
}

fn mark(update: impl FnOnce(&mut Marks)) {
    MARKS.with(|marks| {
        let mut value = marks.get();
        update(&mut value);
        marks.set(value);
    });
}

fn note_callback(started: Instant) {
    mark(|marks| {
        marks.callbacks[marks.next_callback] = Some((started, Instant::now()));
        marks.next_callback = (marks.next_callback + 1) % marks.callbacks.len();
    });
}

/// How long each step of one pump stop took, from posting `WM_CLOSE` to the joined thread.
#[derive(Clone, Debug)]
pub(super) struct StopReport {
    pub(super) total: Duration,
    phases: Vec<(&'static str, Option<Duration>)>,
    /// `WinEvent` callbacks that were still running or ran after `WM_CLOSE` was posted.
    late_callbacks: usize,
    late_callback_time: Duration,
}

impl StopReport {
    fn new(posted: Instant, marks: &Marks, joined: Instant) -> Self {
        let steps = [
            ("WM_CLOSE dispatch", marks.close),
            ("DestroyWindow to PostQuitMessage", marks.quit_posted),
            ("rest of DestroyWindow", marks.destroyed),
            ("leaving GetMessageW", marks.loop_left),
            ("UnhookWinEvent foreground", marks.unhooked[0]),
            ("UnhookWinEvent move/size", marks.unhooked[1]),
            ("WTSUnRegisterSessionNotification", marks.unregistered),
            ("pump cleanup", marks.returned),
            ("thread exit", Some(joined)),
        ];
        let mut previous = posted;
        let phases = steps
            .into_iter()
            .map(|(name, at)| {
                let took = at.map(|at| at.saturating_duration_since(previous));
                previous = at.unwrap_or(previous);
                (name, took)
            })
            .collect();
        let late: Vec<Duration> = marks
            .callbacks
            .iter()
            .flatten()
            .filter(|(_, ended)| *ended > posted)
            .map(|(started, ended)| ended.saturating_duration_since((*started).max(posted)))
            .collect();
        Self {
            total: joined.saturating_duration_since(posted),
            phases,
            late_callbacks: late.len(),
            late_callback_time: late.iter().sum(),
        }
    }

    /// The step that took longest, by name.
    pub(super) fn slowest(&self) -> &'static str {
        self.phases
            .iter()
            .max_by_key(|(_, took)| took.unwrap_or_default())
            .map_or("none", |(name, _)| name)
    }
}

impl fmt::Display for StopReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "stopped in {:?}:", self.total)?;
        for (name, took) in &self.phases {
            match took {
                Some(took) => write!(f, " {name} {took:?},")?,
                None => write!(f, " {name} skipped,")?,
            }
        }
        write!(
            f,
            " {} WinEvent callback(s) after the close was posted ({:?}); slowest: {}",
            self.late_callbacks,
            self.late_callback_time,
            self.slowest()
        )
    }
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

    /// Stops the pump and reports how long each shutdown step took.
    #[cfg(test)]
    pub(super) fn stop(mut self) -> Option<StopReport> {
        self.shutdown()
    }

    fn shutdown(&mut self) -> Option<StopReport> {
        let thread = self.thread.take()?;
        let hwnd = HWND(self.window as *mut core::ffi::c_void);
        let posted = Instant::now();
        // SAFETY: `PostMessageW` only queues a message for the pump thread; the handle belongs
        // to a window this struct created and destroys in its own `WM_CLOSE` handler.
        #[allow(unsafe_code)]
        if let Err(error) = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) } {
            warn!(%error, "platform pump: WM_CLOSE could not be posted");
        }
        let Ok(marks) = thread.join() else {
            warn!("platform pump thread panicked");
            return None;
        };
        Some(StopReport::new(posted, &marks, Instant::now()))
    }
}

impl Drop for Pump {
    fn drop(&mut self) {
        if let Some(report) = self.shutdown() {
            if report.total > STOP_BUDGET {
                warn!(%report, "platform pump: slow stop");
            } else {
                debug!(%report, "platform pump: stop");
            }
        }
    }
}

fn run(
    events: broadcast::Sender<PlatformEvent>,
    ready: &mpsc::Sender<PlatformResult<isize>>,
) -> Marks {
    SENDER.with(|sender| *sender.borrow_mut() = Some(events));

    let window = match create_window() {
        Ok(window) => window,
        Err(error) => {
            // A closed receiver only means the caller gave up waiting; nothing left to do.
            let _ = ready.send(Err(error));
            return Marks::default();
        }
    };
    let hooks = [
        install_hook(
            EVENT_SYSTEM_FOREGROUND,
            EVENT_SYSTEM_FOREGROUND,
            foreground_proc,
        ),
        install_hook(
            EVENT_SYSTEM_MOVESIZESTART,
            EVENT_SYSTEM_MOVESIZEEND,
            move_size_proc,
        ),
    ];
    let session_notifications = register_session_notifications(window);
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
        mark(|marks| marks.loop_left = Some(Instant::now()));
        for (index, hook) in hooks.into_iter().enumerate() {
            if let Some(hook) = hook
                && !UnhookWinEvent(hook).as_bool()
            {
                warn!("platform pump: UnhookWinEvent failed");
            }
            mark(|marks| marks.unhooked[index] = Some(Instant::now()));
        }
        // The window is already destroyed by now; un-registration is best effort.
        if session_notifications {
            let _ = WTSUnRegisterSessionNotification(window);
        }
        mark(|marks| marks.unregistered = Some(Instant::now()));
    }
    SENDER.with(|sender| sender.borrow_mut().take());
    mark(|marks| marks.returned = Some(Instant::now()));
    MARKS.with(Cell::get)
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

type WinEventProc = unsafe extern "system" fn(HWINEVENTHOOK, u32, HWND, i32, i32, u32, u32);

fn install_hook(min: u32, max: u32, callback: WinEventProc) -> Option<HWINEVENTHOOK> {
    // SAFETY: out-of-context hooks deliver events through this thread's message loop; the
    // callback is an `extern "system"` fn with the documented signature.
    #[allow(unsafe_code)]
    let hook = unsafe {
        SetWinEventHook(
            min,
            max,
            None,
            Some(callback),
            0,
            0,
            WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
        )
    };
    if hook.is_invalid() {
        warn!(
            min,
            max, "platform pump: SetWinEventHook failed; these events are disabled"
        );
        return None;
    }
    Some(hook)
}

/// Asks for `WM_WTSSESSION_CHANGE` on the pump window; `false` when the service is unavailable
/// (lock events are then never produced and the notch simply stays put).
fn register_session_notifications(window: HWND) -> bool {
    // SAFETY: the window belongs to this thread and outlives the registration, which is undone
    // after the message loop ends.
    #[allow(unsafe_code)]
    match unsafe { WTSRegisterSessionNotification(window, NOTIFY_FOR_THIS_SESSION) } {
        Ok(()) => true,
        Err(error) => {
            warn!(%error, "platform pump: WTSRegisterSessionNotification failed; lock events disabled");
            false
        }
    }
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
        WM_WTSSESSION_CHANGE => {
            // Only the lock state matters to the shell; logon/logoff and remote
            // connect/disconnect are ignored. `wparam` fits `u32` for every documented code.
            match u32::try_from(wparam.0).unwrap_or(0) {
                WTS_SESSION_LOCK => publish(PlatformEvent::SessionLockChanged { locked: true }),
                WTS_SESSION_UNLOCK => {
                    publish(PlatformEvent::SessionLockChanged { locked: false });
                }
                _ => {}
            }
            LRESULT(0)
        }
        WM_POWERBROADCAST => {
            // Only the AC/battery status change matters; suspend/resume codes are ignored.
            if u32::try_from(wparam.0).unwrap_or(0) == PBT_APMPOWERSTATUSCHANGE {
                match power::battery() {
                    Ok(state) => publish(PlatformEvent::BatteryChanged(state)),
                    Err(error) => warn!(%error, "platform pump: power status read failed"),
                }
            }
            // `TRUE` acknowledges a power broadcast.
            LRESULT(1)
        }
        WM_CLOSE => {
            mark(|marks| marks.close = Some(Instant::now()));
            // SAFETY: `hwnd` is the pump window handed to us by the OS for this message.
            if unsafe { DestroyWindow(hwnd) }.is_err() {
                warn!("platform pump: DestroyWindow failed");
            }
            mark(|marks| marks.destroyed = Some(Instant::now()));
            LRESULT(0)
        }
        WM_DESTROY => {
            // SAFETY: posting WM_QUIT to the current thread has no preconditions.
            unsafe { PostQuitMessage(0) };
            mark(|marks| marks.quit_posted = Some(Instant::now()));
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
    let started = Instant::now();
    if id_object == OBJID_WINDOW.0 && id_child == CHILDID_SELF.cast_signed() && !hwnd.is_invalid() {
        publish(PlatformEvent::ForegroundChanged(foreground::snapshot(hwnd)));
    }
    note_callback(started);
}

#[allow(unsafe_code)]
unsafe extern "system" fn move_size_proc(
    _hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    id_object: i32,
    id_child: i32,
    _thread: u32,
    _time: u32,
) {
    let started = Instant::now();
    if id_object == OBJID_WINDOW.0 && id_child == CHILDID_SELF.cast_signed() && !hwnd.is_invalid() {
        publish(PlatformEvent::MoveSizeChanged {
            started: event == EVENT_SYSTEM_MOVESIZESTART,
            window: hwnd.0 as isize,
        });
    }
    note_callback(started);
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

    #[test]
    fn a_stop_report_names_each_step_and_the_slowest() {
        let origin = Instant::now();
        let posted = origin + Duration::from_millis(10);
        let at = |ms: u64| Some(posted + Duration::from_millis(ms));
        let marks = Marks {
            close: at(1),
            quit_posted: at(2),
            destroyed: at(4),
            loop_left: at(4),
            unhooked: [at(5), None],
            unregistered: at(6),
            returned: at(6),
            callbacks: [
                Some((origin, origin + Duration::from_millis(1))),
                Some((
                    origin + Duration::from_millis(9),
                    posted + Duration::from_millis(1),
                )),
                None,
                None,
            ],
            next_callback: 2,
        };
        let report = StopReport::new(posted, &marks, posted + Duration::from_millis(706));

        assert_eq!(report.total, Duration::from_millis(706));
        assert_eq!(report.slowest(), "thread exit");
        assert_eq!(report.late_callbacks, 1);
        assert_eq!(report.late_callback_time, Duration::from_millis(1));
        let text = report.to_string();
        assert!(text.contains("WM_CLOSE dispatch 1ms,"), "{text}");
        assert!(text.contains("rest of DestroyWindow 2ms,"), "{text}");
        assert!(text.contains("UnhookWinEvent move/size skipped,"), "{text}");
        assert!(
            text.contains("WTSUnRegisterSessionNotification 1ms,"),
            "{text}"
        );
        assert!(text.contains("thread exit 700ms,"), "{text}");
        assert!(text.ends_with("slowest: thread exit"), "{text}");
    }

    /// Spike S3 (docs/spikes/m4-snap.md): a real title-bar drag of a window in *another*
    /// process must reach the pump's subscribers as `MoveSizeChanged { started: true }`
    /// within one frame, and dropping the pump must join its thread. The other process is this
    /// test binary re-run as [`s3_helper_window`]; the drag is injected with `SendInput`, so
    /// the cursor moves for a moment and is put back afterwards. Holds the desktop lock so no
    /// other input test shares the cursor. A system prompt would dim the desktop and take the
    /// click for longer than any lock is held, so the one test that can raise one — location
    /// consent — is an integration test, `tests/location.rs`, which cargo runs after this binary
    /// (#89).
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session and moves the mouse"
    )]
    fn s3_a_foreign_window_drag_is_reported_within_a_frame() {
        use std::time::Duration;

        let _desktop = super::super::test_support::desktop();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        let resting = s3::cursor_position();
        let mut rounds = Vec::new();
        for round in 0..5 {
            let timing = s3::drag_round(&runtime);
            eprintln!(
                "S3 round {round}: MOVESIZESTART after {:?}, MOVESIZEEND after {:?}, pump {}",
                timing.start, timing.end, timing.stop
            );
            assert!(
                timing.stop.total < super::STOP_BUDGET,
                "the pump thread took {:?} to stop, longer than {:?}; {}",
                timing.stop.total,
                super::STOP_BUDGET,
                timing.stop
            );
            rounds.push(timing);
        }
        s3::set_cursor_position(resting);

        let mut starts: Vec<Duration> = rounds.iter().map(|t| t.start).collect();
        let mut ends: Vec<Duration> = rounds.iter().map(|t| t.end).collect();
        starts.sort();
        ends.sort();
        eprintln!(
            "S3 summary: MOVESIZESTART min {:?} median {:?} max {:?}; MOVESIZEEND min {:?} \
             median {:?} max {:?}",
            starts[0], starts[2], starts[4], ends[0], ends[2], ends[4]
        );
        // MOVESIZEEND is raised synchronously on button-up, so it measures the hook path alone:
        // OS → hook thread → broadcast → subscriber must fit in a frame. MOVESIZESTART also
        // waits for the OS to confirm the drag; it must still beat the 120 ms intent delay the
        // motion spec adds before the zones appear.
        assert!(
            ends[2] <= Duration::from_millis(16),
            "median MOVESIZEEND latency {:?} exceeds one frame",
            ends[2]
        );
        assert!(
            starts[4] <= Duration::from_millis(120),
            "slowest MOVESIZESTART {:?} would arrive after the zones are due",
            starts[4]
        );
    }

    /// The other process for [`s3_a_foreign_window_drag_is_reported_within_a_frame`]: shows a
    /// small top-most window, prints `READY <hwnd> <x> <y> <w> <h>` and pumps messages until
    /// it is killed. Does nothing unless spawned by that test.
    #[test]
    #[ignore = "helper process for the S3 spike, spawned by the spike test"]
    fn s3_helper_window() {
        if std::env::var_os("MUNA_S3_HELPER").is_some() {
            s3::run_helper_window();
        }
    }

    /// Plumbing for the S3 spike test: input injection, the helper process and one timed drag.
    mod s3 {
        use std::io::{BufRead, BufReader, Write};
        use std::process::{Child, Command, Stdio};
        use std::time::{Duration, Instant};

        use tokio::runtime::Runtime;
        use tokio::sync::broadcast;
        use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            INPUT, INPUT_0, INPUT_MOUSE, MOUSE_EVENT_FLAGS, MOUSEEVENTF_LEFTDOWN,
            MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MOVE, MOUSEINPUT, SendInput,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DispatchMessageW, GetClassNameW, GetCursorPos,
            GetForegroundWindow, GetMessageW, GetWindowRect, HWND_TOPMOST, MSG, PostQuitMessage,
            RegisterClassW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SetCursorPos,
            SetWindowPos, TranslateMessage, WM_DESTROY, WNDCLASSW, WS_EX_TOPMOST,
            WS_OVERLAPPEDWINDOW, WS_VISIBLE, WindowFromPoint,
        };
        use windows::core::{PCWSTR, w};

        use super::super::{Pump, StopReport};
        use crate::events::PlatformEvent;
        use crate::types::WindowHandle;
        use crate::windows::foreground;

        const HELPER_CLASS: PCWSTR = w!("MunaS3Helper");

        /// What one injected drag measured.
        pub(super) struct Timing {
            /// First movement after button down → `MoveSizeChanged { started: true }` received.
            pub(super) start: Duration,
            /// Button up → `MoveSizeChanged { started: false }` received.
            pub(super) end: Duration,
            /// `WM_CLOSE` posted → thread joined, step by step.
            pub(super) stop: StopReport,
        }

        /// The helper window as its process reported it.
        struct HelperWindow {
            child: Child,
            hwnd: WindowHandle,
            x: i32,
            y: i32,
            width: i32,
        }

        pub(super) fn cursor_position() -> POINT {
            let mut point = POINT::default();
            // SAFETY: `point` is a valid, writable `POINT`.
            #[allow(unsafe_code)]
            unsafe {
                GetCursorPos(&raw mut point).unwrap();
            }
            point
        }

        pub(super) fn set_cursor_position(point: POINT) {
            // SAFETY: plain cursor placement; the result is checked.
            #[allow(unsafe_code)]
            unsafe {
                SetCursorPos(point.x, point.y).unwrap();
            }
        }

        fn inject(flags: MOUSE_EVENT_FLAGS, dx: i32, dy: i32) {
            let input = INPUT {
                r#type: INPUT_MOUSE,
                Anonymous: INPUT_0 {
                    mi: MOUSEINPUT {
                        dx,
                        dy,
                        mouseData: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            };
            // SAFETY: one fully initialised `INPUT` and its size; the count returned is checked.
            #[allow(unsafe_code)]
            let sent = unsafe { SendInput(&[input], i32::try_from(size_of::<INPUT>()).unwrap()) };
            assert_eq!(sent, 1, "SendInput refused the event");
        }

        /// Re-runs this test binary as the helper and waits for its `READY` line.
        fn spawn_helper() -> HelperWindow {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "windows::pump::tests::s3_helper_window",
                    "--ignored",
                    "--nocapture",
                ])
                .env("MUNA_S3_HELPER", "1")
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .unwrap();
            let stdout = child.stdout.take().unwrap();
            let mut lines = BufReader::new(stdout).lines();
            let ready = loop {
                let line = lines.next().unwrap().unwrap();
                if let Some(rest) = line.strip_prefix("READY ") {
                    break rest.to_owned();
                }
            };
            let fields: Vec<i64> = ready.split(' ').map(|f| f.parse().unwrap()).collect();
            HelperWindow {
                child,
                hwnd: isize::try_from(fields[0]).unwrap(),
                x: i32::try_from(fields[1]).unwrap(),
                y: i32::try_from(fields[2]).unwrap(),
                width: i32::try_from(fields[3]).unwrap(),
            }
        }

        /// Waits up to three seconds for a `MoveSizeChanged` with the wanted phase and returns
        /// the window it named.
        fn await_move_size(
            runtime: &Runtime,
            rx: &mut broadcast::Receiver<PlatformEvent>,
            wanted: bool,
        ) -> WindowHandle {
            runtime
                .block_on(async {
                    tokio::time::timeout(Duration::from_secs(3), async {
                        loop {
                            match rx.recv().await {
                                Ok(PlatformEvent::MoveSizeChanged { started, window })
                                    if started == wanted =>
                                {
                                    break window;
                                }
                                Ok(_) => {}
                                Err(error) => panic!("event channel closed: {error}"),
                            }
                        }
                    })
                    .await
                })
                .unwrap_or_else(|_| {
                    panic!(
                        "MoveSizeChanged {{ started: {wanted} }} never arrived; {}",
                        describe_pointer_state()
                    )
                })
        }

        /// The window under the cursor and the foreground window, by class, for the failure
        /// messages: a covered helper is a desktop problem, not a pump problem.
        fn describe_pointer_state() -> String {
            let cursor = cursor_position();
            // SAFETY: plain queries with no preconditions.
            #[allow(unsafe_code)]
            let (under, foreground) = unsafe { (WindowFromPoint(cursor), GetForegroundWindow()) };
            format!(
                "cursor ({}, {}); under cursor {:?} '{}'; foreground {:?} '{}'",
                cursor.x,
                cursor.y,
                under.0,
                class_name(under),
                foreground.0,
                class_name(foreground)
            )
        }

        fn class_name(hwnd: HWND) -> String {
            let mut buffer = [0_u16; 128];
            // SAFETY: a valid, writable buffer; the length returned is checked.
            #[allow(unsafe_code)]
            let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
            String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0)])
        }

        /// A window for the logs: handle, class, title, owning process and rectangle.
        fn describe_window(hwnd: HWND) -> String {
            let window = foreground::snapshot(hwnd);
            let mut rect = RECT::default();
            // SAFETY: `rect` is a valid, writable `RECT`; the result is checked below.
            #[allow(unsafe_code)]
            let placed = unsafe { GetWindowRect(hwnd, &raw mut rect) };
            let place = match placed {
                Ok(()) => format!(
                    "[{}, {}, {}, {}]",
                    rect.left, rect.top, rect.right, rect.bottom
                ),
                Err(error) => format!("unknown ({error})"),
            };
            format!(
                "{:?} '{}' \"{}\" of {} at {place}",
                hwnd.0,
                class_name(hwnd),
                window.title,
                window.process_name
            )
        }

        /// Waits until the helper's caption is what a click at `target` would hit. Something
        /// else there — a system dialog, an OSD, a window the person at the machine moved — means
        /// the injected drag would land on it, so the test waits a little and otherwise fails
        /// naming the cover rather than clicking it.
        fn wait_until_uncovered(helper: &HelperWindow, target: POINT) {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut reported = false;
            loop {
                // SAFETY: a plain query with no preconditions.
                #[allow(unsafe_code)]
                let under = unsafe { WindowFromPoint(target) };
                if under.0 as isize == helper.hwnd {
                    return;
                }
                let cover = describe_window(under);
                assert!(
                    Instant::now() < deadline,
                    "the helper window is covered at ({}, {}) by {cover}",
                    target.x,
                    target.y
                );
                if !reported {
                    // Straight to the handle, past the harness's capture, so a run that passes
                    // once the cover goes away still says what it was.
                    let _ = writeln!(
                        std::io::stderr(),
                        "S3: helper covered at ({}, {}) by {cover}; waiting",
                        target.x,
                        target.y
                    );
                    reported = true;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        }

        /// One full round: start a pump, spawn the helper, drag its caption 40 px, release,
        /// stop the pump; every phase timed.
        pub(super) fn drag_round(runtime: &Runtime) -> Timing {
            let (events, mut rx) = broadcast::channel(16);
            let pump = Pump::start(events).unwrap();
            let mut helper = spawn_helper();
            std::thread::sleep(Duration::from_millis(300));

            let target = POINT {
                x: helper.x + helper.width / 2,
                y: helper.y + 12,
            };
            wait_until_uncovered(&helper, target);
            set_cursor_position(target);
            std::thread::sleep(Duration::from_millis(50));
            inject(MOUSEEVENTF_LEFTDOWN, 0, 0);
            std::thread::sleep(Duration::from_millis(10));
            // The OS confirms a drag only once the cursor leaves the drag rectangle
            // (`SM_CXDRAG`), so the clock starts at the first movement, not the press.
            let pressed_at = Instant::now();
            for _ in 0..4 {
                inject(MOUSEEVENTF_MOVE, 10, 0);
                std::thread::sleep(Duration::from_millis(10));
            }
            let dragged = await_move_size(runtime, &mut rx, true);
            let start = pressed_at.elapsed();
            assert_eq!(dragged, helper.hwnd, "the event names the dragged window");

            std::thread::sleep(Duration::from_millis(60));
            let released_at = Instant::now();
            inject(MOUSEEVENTF_LEFTUP, 0, 0);
            await_move_size(runtime, &mut rx, false);
            let end = released_at.elapsed();

            let stop = pump.stop().expect("the pump thread did not panic");
            let _ = helper.child.kill();
            let _ = helper.child.wait();
            Timing { start, end, stop }
        }

        #[allow(unsafe_code)]
        unsafe extern "system" fn helper_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            if message == WM_DESTROY {
                // SAFETY: posting WM_QUIT to the current thread has no preconditions.
                unsafe { PostQuitMessage(0) };
                return LRESULT(0);
            }
            // SAFETY: forwarding the exact arguments the OS gave us.
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }

        /// The helper process body: a visible top-most overlapped window that reports its
        /// handle and rectangle, then pumps messages until the parent kills the process.
        pub(super) fn run_helper_window() {
            // SAFETY: documented Win32 registration/creation calls with valid `'static` or
            // stack data; the window dies with the process.
            #[allow(unsafe_code)]
            unsafe {
                let module = GetModuleHandleW(None).unwrap();
                let class = WNDCLASSW {
                    lpfnWndProc: Some(helper_proc),
                    hInstance: HINSTANCE(module.0),
                    lpszClassName: HELPER_CLASS,
                    ..Default::default()
                };
                RegisterClassW(&raw const class);
                let hwnd = CreateWindowExW(
                    WS_EX_TOPMOST,
                    HELPER_CLASS,
                    w!("Muna S3 helper"),
                    WS_OVERLAPPEDWINDOW | WS_VISIBLE,
                    240,
                    240,
                    320,
                    160,
                    None,
                    None,
                    Some(HINSTANCE(module.0)),
                    None,
                )
                .unwrap();
                SetWindowPos(
                    hwnd,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE,
                )
                .unwrap();
                let mut rect = RECT::default();
                GetWindowRect(hwnd, &raw mut rect).unwrap();
                let mut out = std::io::stdout().lock();
                writeln!(
                    out,
                    "READY {} {} {} {} {}",
                    hwnd.0 as isize,
                    rect.left,
                    rect.top,
                    rect.right - rect.left,
                    rect.bottom - rect.top
                )
                .unwrap();
                out.flush().unwrap();
                drop(out);
                let mut message = MSG::default();
                while GetMessageW(&raw mut message, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&raw const message);
                    DispatchMessageW(&raw const message);
                }
            }
        }
    }
}
