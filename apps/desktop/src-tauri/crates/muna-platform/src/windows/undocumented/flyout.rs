//! Hides the shell's volume/brightness flyout (docs/modules/hud.md "Suppress native flyout",
//! docs/04 ⚠️ "Suppress native OSD") so the HUD in the strip is the only thing the user sees.
//!
//! **Technique** (the same one `ModernFlyouts`' `NativeFlyoutHandler` uses; written from the
//! description, not the code): the OSD is a pair of windows owned by `explorer.exe` —
//! `XamlExplorerHostIslandWindow` ⊃ `Windows.UI.Composition.DesktopWindowContentBridge` on
//! builds ≥ 22620, `NativeHWNDHost` ⊃ `DirectUIHWND` before — and only the pair whose outer
//! window sits in [`ZBID_ABOVELOCK_UX`] is the OSD (other explorer hosts share the class, and
//! grabbing the wrong one would hide Alt-Tab). Minimising the *inner* window keeps the outer
//! host alive so the shell never recreates it, and stops it from painting. Verified on
//! 26200.9457: after `ShowWindowAsync(inner, SW_MINIMIZE)` a volume key changes nothing on
//! screen; `SW_RESTORE` brings the flyout back.
//!
//! **Keeping it hidden**: a keeper thread hooks `EVENT_OBJECT_CREATE…EVENT_OBJECT_SHOW` on
//! explorer's process and re-minimises whenever the shell recreates or shows the window, plus
//! a 3 s timer that catches an explorer restart (new PID → re-hook). The timer only runs while
//! suppression is on.
//!
//! **Crash safety**: before suppressing, a watchdog process (`muna.exe --watchdog <pid>`, see
//! [`run_watchdog`]) is spawned; it waits for this process to end and restores the window.
//! If it cannot be spawned nothing is suppressed — a stuck-hidden flyout would be worse than
//! no HUD.
//!
//! Deviation from the spec: no synthetic volume nudge at start-up. Core Audio changes do not
//! create the flyout window and a key press would flash it; instead the create hook catches
//! the window the first time the shell makes it, so at most the very first flyout of the
//! session is visible for one frame.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::JoinHandle;

use parking_lot::Mutex;
use tracing::{debug, info, warn};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetCurrentThreadId, INFINITE, OpenProcess, PROCESS_SYNCHRONIZE,
    WaitForSingleObject,
};
use windows::Win32::UI::Accessibility::{HWINEVENTHOOK, SetWinEventHook, UnhookWinEvent};
use windows::Win32::UI::WindowsAndMessaging::{
    CHILDID_SELF, DispatchMessageW, EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW,
    EVENT_SYSTEM_MINIMIZEEND, FindWindowExW, GetClassNameW, GetMessageW, GetWindowThreadProcessId,
    IsIconic, KillTimer, MSG, OBJID_WINDOW, PM_NOREMOVE, PeekMessageW, PostThreadMessageW,
    SW_MINIMIZE, SW_RESTORE, SetTimer, ShowWindowAsync, WINEVENT_OUTOFCONTEXT, WM_APP, WM_QUIT,
    WM_TIMER, WM_USER,
};
use windows::core::{PCWSTR, w};

use super::{ZBID_ABOVELOCK_UX, window_band};
use crate::OSD_WATCHDOG_ARG;
use crate::error::{PlatformError, PlatformResult};
use crate::types::OsdState;
use crate::windows::foreground;

const SHELL_PROCESS: &str = "explorer.exe";
/// Re-check interval while suppressed: catches an explorer restart and a missed hook event.
const RECHECK_MS: u32 = 3000;
const TIMER_ID: usize = 1;
/// Thread message: the desired state changed, re-apply it.
const WM_KEEPER_REFRESH: u32 = WM_APP + 1;

/// One window pair per build generation: (outer class, inner class).
const WINDOW_PAIRS: [(PCWSTR, PCWSTR); 2] = [
    (
        w!("XamlExplorerHostIslandWindow"),
        w!("Windows.UI.Composition.DesktopWindowContentBridge"),
    ),
    (w!("NativeHWNDHost"), w!("DirectUIHWND")),
];

/// The OSD window pair, once located.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Osd {
    outer: HWND,
    inner: HWND,
}

/// Walks the top-level windows of every known class and returns the pair that belongs to
/// explorer.exe and sits in the OSD z-band.
fn find_osd() -> Option<Osd> {
    for (outer_class, inner_class) in WINDOW_PAIRS {
        let mut previous: Option<HWND> = None;
        loop {
            // SAFETY: documented enumeration; `previous` is either `None` or a handle this loop
            // received from the same call one iteration earlier.
            #[allow(unsafe_code)]
            let outer = unsafe { FindWindowExW(None, previous, outer_class, PCWSTR::null()) };
            let Ok(outer) = outer else {
                break;
            };
            if outer.is_invalid() {
                break;
            }
            previous = Some(outer);
            if !is_shell_window(outer) || window_band(outer) != Some(ZBID_ABOVELOCK_UX) {
                continue;
            }
            // SAFETY: as above, scoped to the children of `outer`.
            #[allow(unsafe_code)]
            let inner = unsafe { FindWindowExW(Some(outer), None, inner_class, PCWSTR::null()) };
            if let Ok(inner) = inner
                && !inner.is_invalid()
            {
                return Some(Osd { outer, inner });
            }
        }
    }
    None
}

fn is_shell_window(hwnd: HWND) -> bool {
    foreground::process_name(hwnd).eq_ignore_ascii_case(SHELL_PROCESS)
}

fn is_iconic(hwnd: HWND) -> bool {
    // SAFETY: plain query on a window handle; an invalid handle simply reports `false`.
    #[allow(unsafe_code)]
    unsafe {
        IsIconic(hwnd).as_bool()
    }
}

fn show_async(hwnd: HWND, command: windows::Win32::UI::WindowsAndMessaging::SHOW_WINDOW_CMD) {
    // SAFETY: `ShowWindowAsync` only posts to the window's own thread; it never blocks on
    // explorer and a failure (window gone) is harmless.
    #[allow(unsafe_code)]
    let posted = unsafe { ShowWindowAsync(hwnd, command) }.as_bool();
    if !posted {
        debug!(?command, "flyout: ShowWindowAsync was not accepted");
    }
}

/// Minimises the OSD's inner window if it exists and is not already hidden.
fn apply_suppression() -> OsdState {
    match find_osd() {
        Some(osd) => {
            if !is_iconic(osd.inner) {
                show_async(osd.inner, SW_MINIMIZE);
            }
            OsdState::Suppressed
        }
        None => OsdState::Unavailable,
    }
}

/// Restores the OSD's inner window if it exists and is hidden. Idempotent; safe to call from
/// any thread or process.
pub fn restore_native() -> OsdState {
    match find_osd() {
        Some(osd) => {
            if is_iconic(osd.inner) {
                show_async(osd.inner, SW_RESTORE);
            }
            OsdState::Native
        }
        None => OsdState::Unavailable,
    }
}

/// Watchdog entry point: waits for `parent_pid` to exit, restores the flyout and returns the
/// process exit code. Restoring is best effort, so this is always `0`; the value exists so
/// `main.rs` can `std::process::exit` with it.
#[must_use]
pub fn run_watchdog(parent_pid: u32) -> i32 {
    // SAFETY: `OpenProcess` with `SYNCHRONIZE` only; the handle is waited on once and the
    // process ends right after, which closes it. A failed open means the parent is already
    // gone, so restoring immediately is the right thing.
    #[allow(unsafe_code)]
    unsafe {
        if let Ok(parent) = OpenProcess(PROCESS_SYNCHRONIZE, false, parent_pid) {
            let _ = WaitForSingleObject(parent, INFINITE);
        }
    }
    let state = restore_native();
    info!(
        ?state,
        parent_pid, "flyout watchdog: parent exited, native flyout restored"
    );
    0
}

/// Spawns `muna.exe --watchdog <our pid>` detached from our console and stdio.
fn spawn_watchdog() -> PlatformResult<std::process::Child> {
    let exe = std::env::current_exe().map_err(|error| PlatformError::Os {
        api: "GetModuleFileNameW",
        code: error.raw_os_error().unwrap_or(0).cast_unsigned(),
    })?;
    // SAFETY: no arguments, cannot fail.
    #[allow(unsafe_code)]
    let pid = unsafe { GetCurrentProcessId() };
    std::process::Command::new(exe)
        .arg(OSD_WATCHDOG_ARG)
        .arg(pid.to_string())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|error| PlatformError::Os {
            api: "CreateProcessW(--watchdog)",
            code: error.raw_os_error().unwrap_or(0).cast_unsigned(),
        })
}

// --- keeper ----------------------------------------------------------------------------------

#[derive(Debug)]
struct Shared {
    /// What the app asked for last; `Drop` restores only when this is `true`.
    desired: AtomicBool,
    state: Mutex<OsdState>,
    thread_id: u32,
}

/// Owns the keeper thread and the watchdog. Dropping it restores the flyout and stops both.
#[derive(Debug)]
pub struct Keeper {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
    watchdog: Mutex<Option<std::process::Child>>,
}

impl Keeper {
    /// Starts the keeper thread (idle until the first `set_suppressed(true)`).
    pub fn start() -> PlatformResult<Self> {
        let (ready_tx, ready_rx) = mpsc::channel::<u32>();
        let thread = std::thread::Builder::new()
            .name("muna-platform-flyout".into())
            .spawn(move || run_keeper(&ready_tx))
            .map_err(|_| PlatformError::Unsupported("flyout keeper thread"))?;
        let thread_id = ready_rx
            .recv()
            .map_err(|_| PlatformError::Unsupported("flyout keeper thread exited early"))?;
        Ok(Self {
            shared: Arc::new(Shared {
                desired: AtomicBool::new(false),
                state: Mutex::new(OsdState::Native),
                thread_id,
            }),
            thread: Some(thread),
            watchdog: Mutex::new(None),
        })
    }

    /// Applies the change on the calling thread (so the returned state is current) and tells
    /// the keeper thread to arm or disarm its hook and timer.
    pub fn set_suppressed(&self, suppressed: bool) -> PlatformResult<OsdState> {
        if suppressed {
            self.ensure_watchdog()?;
        }
        let state = if suppressed {
            apply_suppression()
        } else {
            restore_native()
        };
        self.shared.desired.store(suppressed, Ordering::Release);
        *self.shared.state.lock() = state;
        self.post(WM_KEEPER_REFRESH, WPARAM(usize::from(suppressed)));
        info!(?state, suppressed, "flyout: suppression changed");
        Ok(state)
    }

    pub fn state(&self) -> OsdState {
        *self.shared.state.lock()
    }

    fn ensure_watchdog(&self) -> PlatformResult<()> {
        let mut watchdog = self.watchdog.lock();
        let alive = matches!(
            watchdog.as_mut().map(std::process::Child::try_wait),
            Some(Ok(None))
        );
        if alive {
            return Ok(());
        }
        *watchdog = Some(spawn_watchdog()?);
        debug!("flyout: watchdog spawned");
        Ok(())
    }

    fn post(&self, message: u32, wparam: WPARAM) {
        // SAFETY: posting to a thread id this struct obtained from the thread it owns; the
        // thread created its message queue before reporting the id.
        #[allow(unsafe_code)]
        if let Err(error) =
            unsafe { PostThreadMessageW(self.shared.thread_id, message, wparam, LPARAM(0)) }
        {
            warn!(%error, "flyout: PostThreadMessageW failed");
        }
    }
}

impl Drop for Keeper {
    fn drop(&mut self) {
        if self.shared.desired.load(Ordering::Acquire) {
            restore_native();
        }
        self.post(WM_QUIT, WPARAM(0));
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            warn!("flyout keeper thread panicked");
        }
        // The watchdog notices this process ending and exits by itself; nothing to do here.
    }
}

thread_local! {
    /// The keeper thread's view of the desired state (set through `WM_KEEPER_REFRESH`).
    static DESIRED: RefCell<Option<bool>> = const { RefCell::new(None) };
    /// The keeper thread's armed hooks and the explorer PID they target.
    static HOOKS: RefCell<Option<Hooks>> = const { RefCell::new(None) };
}

struct Hooks {
    handles: Vec<HWINEVENTHOOK>,
    explorer: u32,
}

/// Event ranges worth a re-check: the shell (re)creating or showing the window, and anything
/// un-minimising it. Two narrow hooks instead of one wide range keeps explorer's chatty
/// location/focus events out of this thread's queue.
const HOOK_RANGES: [(u32, u32); 2] = [
    (EVENT_OBJECT_CREATE, EVENT_OBJECT_SHOW),
    (EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZEEND),
];

fn run_keeper(ready: &mpsc::Sender<u32>) {
    let mut message = MSG::default();
    // SAFETY: `PeekMessageW` with `PM_NOREMOVE` on this thread only forces the creation of its
    // message queue, which must exist before anyone posts to the thread id; then a standard
    // message loop until `WM_QUIT`.
    #[allow(unsafe_code)]
    unsafe {
        let _ = PeekMessageW(&raw mut message, None, WM_USER, WM_USER, PM_NOREMOVE);
        // A closed receiver only means the caller gave up waiting; nothing left to do.
        let _ = ready.send(GetCurrentThreadId());
        while GetMessageW(&raw mut message, None, 0, 0).as_bool() {
            match message.message {
                WM_KEEPER_REFRESH => {
                    let suppressed = message.wParam.0 != 0;
                    DESIRED.with(|cell| cell.replace(Some(suppressed)));
                    if suppressed {
                        arm();
                    } else {
                        disarm();
                    }
                }
                WM_TIMER if message.hwnd.is_invalid() => reapply(),
                _ => {
                    DispatchMessageW(&raw const message);
                }
            }
        }
    }
    disarm();
    debug!("flyout keeper stopped");
}

/// Hooks explorer's window creation and starts the re-check timer.
fn arm() {
    rehook();
    // SAFETY: a thread timer (no window) delivers `WM_TIMER` to this thread's queue; the
    // return value is the timer id and zero means failure.
    #[allow(unsafe_code)]
    let timer = unsafe { SetTimer(None, TIMER_ID, RECHECK_MS, None) };
    if timer == 0 {
        warn!("flyout: SetTimer failed; explorer restarts will not be caught");
    }
    reapply();
}

fn disarm() {
    unhook();
    // SAFETY: killing a thread timer this thread set; failure means it was never set.
    #[allow(unsafe_code)]
    let _ = unsafe { KillTimer(None, TIMER_ID) };
}

/// (Re)installs the win-event hooks on the current explorer process when the PID changed.
fn rehook() {
    let Some(explorer) = explorer_pid() else {
        debug!("flyout: explorer.exe not found; will retry");
        unhook();
        return;
    };
    if HOOKS.with(|hooks| {
        hooks
            .borrow()
            .as_ref()
            .is_some_and(|h| h.explorer == explorer)
    }) {
        return;
    }
    unhook();
    let handles: Vec<HWINEVENTHOOK> = HOOK_RANGES
        .iter()
        .filter_map(|&(min, max)| {
            // SAFETY: out-of-context hook scoped to explorer's PID; events are delivered through
            // this thread's message loop to `window_proc`, an `extern "system"` fn with the
            // documented signature.
            #[allow(unsafe_code)]
            let hook = unsafe {
                SetWinEventHook(
                    min,
                    max,
                    None,
                    Some(window_proc),
                    explorer,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                )
            };
            if hook.is_invalid() {
                warn!(
                    min,
                    max, "flyout: SetWinEventHook failed; relying on the timer"
                );
                return None;
            }
            Some(hook)
        })
        .collect();
    if handles.is_empty() {
        return;
    }
    HOOKS.with(|cell| cell.replace(Some(Hooks { handles, explorer })));
    debug!(explorer, "flyout: hooked explorer window events");
}

fn unhook() {
    if let Some(hooks) = HOOKS.with(|cell| cell.borrow_mut().take()) {
        for hook in hooks.handles {
            // SAFETY: the hook was installed by this thread and is removed once.
            #[allow(unsafe_code)]
            if !unsafe { UnhookWinEvent(hook) }.as_bool() {
                warn!("flyout: UnhookWinEvent failed");
            }
        }
    }
}

/// Timer/hook path: re-hook if explorer restarted and re-minimise if the shell restored it.
fn reapply() {
    if DESIRED.with(|cell| *cell.borrow()) != Some(true) {
        return;
    }
    rehook();
    apply_suppression();
}

/// PID of the process owning the OSD host (or the desktop's `Progman`, which explorer owns).
fn explorer_pid() -> Option<u32> {
    let hwnd = find_osd().map(|osd| osd.outer).or_else(|| {
        // SAFETY: documented lookup of the desktop shell window.
        #[allow(unsafe_code)]
        unsafe { FindWindowExW(None, None, w!("Progman"), PCWSTR::null()) }
            .ok()
            .filter(|hwnd| !hwnd.is_invalid())
    })?;
    let mut pid = 0_u32;
    // SAFETY: `pid` is a valid out-pointer; a zero return means the window is gone.
    #[allow(unsafe_code)]
    let thread = unsafe { GetWindowThreadProcessId(hwnd, Some(&raw mut pid)) };
    (thread != 0 && pid != 0).then_some(pid)
}

fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0_u16; 128];
    // SAFETY: `buffer` is a valid, writable UTF-16 buffer whose length is passed along.
    #[allow(unsafe_code)]
    let len = unsafe { GetClassNameW(hwnd, &mut buffer) };
    String::from_utf16_lossy(&buffer[..usize::try_from(len).unwrap_or(0).min(buffer.len())])
}

fn is_osd_class(name: &str) -> bool {
    WINDOW_PAIRS.iter().any(|(outer, inner)| {
        // SAFETY: the constants are NUL-terminated literals from `w!`.
        #[allow(unsafe_code)]
        unsafe {
            outer.to_string().is_ok_and(|s| s == name) || inner.to_string().is_ok_and(|s| s == name)
        }
    })
}

#[allow(unsafe_code)]
unsafe extern "system" fn window_proc(
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
    if is_osd_class(&class_name(hwnd)) {
        reapply();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Both real-OS tests drive the same shell window; serialise them.
    static OSD_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn only_the_known_osd_classes_trigger_a_reapply() {
        assert!(is_osd_class("XamlExplorerHostIslandWindow"));
        assert!(is_osd_class(
            "Windows.UI.Composition.DesktopWindowContentBridge"
        ));
        assert!(is_osd_class("NativeHWNDHost"));
        assert!(is_osd_class("DirectUIHWND"));
        assert!(!is_osd_class("Shell_TrayWnd"));
        assert!(!is_osd_class(""));
    }

    /// Talks to the real OS; only meaningful on the nightly lab machine. Suppresses, checks the
    /// inner window goes iconic, restores, checks it comes back — and always restores.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session with the shell OSD created"
    )]
    fn suppression_is_reversible_on_this_machine() {
        use std::time::{Duration, Instant};

        let _serial = OSD_LOCK.lock();
        let Some(osd) = find_osd() else {
            eprintln!("no OSD window on this build/session; nothing to test");
            return;
        };
        assert!(is_shell_window(osd.outer));
        assert!(
            !is_iconic(osd.inner),
            "test needs the flyout in its native state"
        );

        let started = Instant::now();
        assert_eq!(apply_suppression(), OsdState::Suppressed);
        while !is_iconic(osd.inner) && started.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let hidden_after = started.elapsed();
        let hidden = is_iconic(osd.inner);

        let started = Instant::now();
        assert_eq!(restore_native(), OsdState::Native);
        while is_iconic(osd.inner) && started.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let restored_after = started.elapsed();
        eprintln!("flyout hidden after {hidden_after:?}, restored after {restored_after:?}");
        assert!(hidden, "inner window never went iconic");
        assert!(!is_iconic(osd.inner), "inner window did not come back");
    }

    /// Talks to the real OS. Runs the keeper end to end: suppress, undo it behind the keeper's
    /// back (as the shell would after an explorer restart), check it re-asserts, release.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "requires a real Windows session with the shell OSD created"
    )]
    fn keeper_reasserts_suppression_until_released() {
        use std::time::{Duration, Instant};

        let _serial = OSD_LOCK.lock();
        let Some(osd) = find_osd() else {
            eprintln!("no OSD window on this build/session; nothing to test");
            return;
        };
        assert!(
            !is_iconic(osd.inner),
            "test needs the flyout in its native state"
        );

        let keeper = Keeper::start().expect("keeper thread");
        assert_eq!(keeper.state(), OsdState::Native);
        assert_eq!(
            keeper.set_suppressed(true).expect("suppress"),
            OsdState::Suppressed
        );
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            is_iconic(osd.inner),
            "keeper did not minimise the inner window"
        );

        // The shell "wins" for a moment; the keeper must notice (hook, else the 3 s timer).
        // SAFETY: plain `ShowWindowAsync` on the handle found above.
        #[allow(unsafe_code)]
        let posted = unsafe { ShowWindowAsync(osd.inner, SW_RESTORE) }.as_bool();
        assert!(posted, "test could not post the restore");
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(50));
        while !is_iconic(osd.inner) && started.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let reasserted_after = started.elapsed();
        let reasserted = is_iconic(osd.inner);

        assert_eq!(
            keeper.set_suppressed(false).expect("release"),
            OsdState::Native
        );
        let started = Instant::now();
        while is_iconic(osd.inner) && started.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        let released = !is_iconic(osd.inner);
        drop(keeper);
        eprintln!("flyout re-asserted after {reasserted_after:?}; released={released}");
        assert!(reasserted, "keeper never re-minimised the window");
        assert!(released, "release did not restore the window");
        assert!(!is_iconic(osd.inner), "drop must leave the flyout native");
    }
}
