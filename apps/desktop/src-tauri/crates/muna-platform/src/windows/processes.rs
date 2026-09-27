//! Other processes for AI coding status (docs/modules/ai-coding.md): is the CLI behind a
//! session still alive, and which window shows it.
//!
//! A CLI never owns a window itself; the terminal hosting it does. Where that terminal sits in
//! the process tree differs per host:
//!
//! - Windows Terminal, VS Code and the GitHub Copilot app are *ancestors* of the shell that
//!   runs the CLI (`copilot` → `pwsh` → `WindowsTerminal`), so the walk goes up.
//! - The legacy console (`conhost.exe`) is a *child* of its first client process, so at every
//!   step the walk also looks at console-host children.
//!
//! The walk stops at the shell (`explorer.exe`) and the system's own processes so a CLI that
//! outlived its terminal never resolves to a File Explorer window, and a parent link is only
//! trusted when the parent started before the child (process ids are recycled).

use std::collections::BTreeMap;

use windows::Win32::Foundation::{
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, FILETIME, HANDLE, HWND, LPARAM,
    STILL_ACTIVE,
};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetExitCodeProcess, GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GWL_EXSTYLE, GWLP_HWNDPARENT, GetWindowLongPtrW, GetWindowTextLengthW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, SW_RESTORE, SetForegroundWindow,
    ShowWindow, WS_EX_TOOLWINDOW,
};
use windows::core::BOOL;

use super::os_error;
use crate::error::{PlatformError, PlatformResult};
use crate::types::WindowHandle;

/// How many parent links the walk follows. Real chains are two to four deep (CLI → shell →
/// pty host → editor); the bound keeps a corrupt or looping snapshot from spinning.
const MAX_DEPTH: usize = 8;

/// Legacy console hosts: the visible window belongs to this child, not to the shell.
const CONSOLE_HOSTS: [&str; 2] = ["conhost.exe", "openconsole.exe"];

/// Where the walk gives up: the shell and the processes every user session hangs off. Their
/// windows are never the terminal the user is looking for.
const ROOTS: [&str; 9] = [
    "explorer.exe",
    "services.exe",
    "svchost.exe",
    "sihost.exe",
    "wininit.exe",
    "winlogon.exe",
    "userinit.exe",
    "csrss.exe",
    "smss.exe",
];

/// One row of the process snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct ProcessEntry {
    pub(super) parent: u32,
    /// Image file name in lower case (`pwsh.exe`).
    pub(super) exe: String,
}

/// What [`main_window`] walks: every process and every candidate window grouped by owner pid.
#[derive(Debug, Default)]
pub(super) struct Snapshot {
    pub(super) processes: BTreeMap<u32, ProcessEntry>,
    /// Top-level, visible, titled windows per process in z-order (front first).
    pub(super) windows: BTreeMap<u32, Vec<WindowHandle>>,
}

fn hwnd(window: WindowHandle) -> HWND {
    HWND(window as *mut core::ffi::c_void)
}

pub(super) fn is_running(pid: u32) -> PlatformResult<bool> {
    if pid == 0 {
        return Ok(false);
    }
    // SAFETY: the handle is opened with the least privilege `GetExitCodeProcess` accepts and
    // closed on every path; `code` is a valid, writable `u32`.
    #[allow(unsafe_code)]
    unsafe {
        let process = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(process) => process,
            // No such process: Windows answers "invalid parameter" for an unknown pid.
            Err(error) if error.code() == ERROR_INVALID_PARAMETER.to_hresult() => {
                return Ok(false);
            }
            // Another user's or a protected process: it exists, that is all we need to know.
            Err(error) if error.code() == ERROR_ACCESS_DENIED.to_hresult() => return Ok(true),
            Err(error) => return Err(os_error("OpenProcess", &error)),
        };
        let mut code = 0_u32;
        let result = GetExitCodeProcess(process, &raw mut code);
        // Best effort: a failed close cannot be acted upon and must not mask the answer.
        let _ = CloseHandle(process);
        result.map_err(|error| os_error("GetExitCodeProcess", &error))?;
        Ok(code == STILL_ACTIVE.0.cast_unsigned())
    }
}

pub(super) fn main_window(pid: u32) -> PlatformResult<Option<WindowHandle>> {
    if pid == 0 {
        return Ok(None);
    }
    let snapshot = Snapshot {
        processes: processes()?,
        windows: windows()?,
    };
    Ok(main_window_in(pid, &snapshot, started_at))
}

pub(super) fn focus(window: WindowHandle) -> PlatformResult<()> {
    // SAFETY: pure queries and requests on a handle we never dereference; `IsWindow` first so
    // a stale handle reads as "gone" instead of acting on whatever reused it.
    #[allow(unsafe_code)]
    unsafe {
        if window == 0 || !IsWindow(Some(hwnd(window))).as_bool() {
            return Err(PlatformError::NotFound("window".to_owned()));
        }
        if IsIconic(hwnd(window)).as_bool() {
            // Returns the previous visibility, not success; the foreground call below decides.
            let _ = ShowWindow(hwnd(window), SW_RESTORE);
        }
        if !SetForegroundWindow(hwnd(window)).as_bool() {
            return Err(PlatformError::AccessDenied("foreground"));
        }
    }
    Ok(())
}

/// The walk behind [`main_window`], separable for tests. `started` answers a process's
/// creation time (any monotone unit) or `None` when it cannot be read; a parent that started
/// after its child is a recycled pid and ends the walk.
pub(super) fn main_window_in(
    pid: u32,
    snapshot: &Snapshot,
    started: impl Fn(u32) -> Option<u64>,
) -> Option<WindowHandle> {
    let first_window = |pid: u32| snapshot.windows.get(&pid).and_then(|w| w.first().copied());
    let mut current = pid;
    for _ in 0..MAX_DEPTH {
        if let Some(window) = first_window(current) {
            return Some(window);
        }
        let console_host = snapshot
            .processes
            .iter()
            .filter(|(_, entry)| entry.parent == current && is_console_host(&entry.exe))
            .find_map(|(child, _)| first_window(*child));
        if console_host.is_some() {
            return console_host;
        }
        let parent = snapshot.processes.get(&current)?.parent;
        if parent == 0 || parent == current {
            return None;
        }
        let parent_entry = snapshot.processes.get(&parent)?;
        if is_root(&parent_entry.exe) {
            return None;
        }
        if let (Some(parent_started), Some(child_started)) = (started(parent), started(current))
            && parent_started > child_started
        {
            return None;
        }
        current = parent;
    }
    None
}

fn is_console_host(exe: &str) -> bool {
    CONSOLE_HOSTS.contains(&exe)
}

fn is_root(exe: &str) -> bool {
    ROOTS.contains(&exe)
}

/// The filter behind the window enumeration, separable for tests: a visible top-level window
/// with a title that is not owned by another window and not a tool window (palettes, Muna's
/// own notch).
#[must_use]
pub(super) fn is_candidate(visible: bool, owner: isize, title_len: i32, ex_style: u32) -> bool {
    visible && owner == 0 && title_len > 0 && ex_style & WS_EX_TOOLWINDOW.0 == 0
}

/// Every process with its parent and image name.
fn processes() -> PlatformResult<BTreeMap<u32, ProcessEntry>> {
    let mut processes = BTreeMap::new();
    // SAFETY: the snapshot handle is closed on every path; `entry` has `dwSize` set as the
    // API requires and is a valid, writable struct for every call.
    #[allow(unsafe_code)]
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
            .map_err(|error| os_error("CreateToolhelp32Snapshot", &error))?;
        let mut entry = PROCESSENTRY32W {
            dwSize: u32::try_from(size_of::<PROCESSENTRY32W>()).unwrap_or(u32::MAX),
            ..PROCESSENTRY32W::default()
        };
        let mut next = Process32FirstW(snapshot, &raw mut entry);
        while next.is_ok() {
            processes.insert(
                entry.th32ProcessID,
                ProcessEntry {
                    parent: entry.th32ParentProcessID,
                    exe: exe_name(&entry.szExeFile),
                },
            );
            next = Process32NextW(snapshot, &raw mut entry);
        }
        // Best effort: a failed close cannot be acted upon and must not mask the snapshot.
        let _ = CloseHandle(snapshot);
    }
    Ok(processes)
}

/// Lower-case image name from a NUL-terminated UTF-16 buffer.
fn exe_name(buffer: &[u16]) -> String {
    let len = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..len]).to_lowercase()
}

/// Candidate windows by owner pid, front to back.
fn windows() -> PlatformResult<BTreeMap<u32, Vec<WindowHandle>>> {
    let mut found: Vec<(u32, WindowHandle)> = Vec::new();
    // SAFETY: `found` outlives the enumeration and is the only thing the callback touches
    // through `lparam`; the callback only queries the handles it is given.
    #[allow(unsafe_code)]
    unsafe {
        EnumWindows(
            Some(collect_window),
            LPARAM((&raw mut found).cast::<core::ffi::c_void>() as isize),
        )
        .map_err(|error| os_error("EnumWindows", &error))?;
    }
    let mut windows: BTreeMap<u32, Vec<WindowHandle>> = BTreeMap::new();
    for (pid, window) in found {
        windows.entry(pid).or_default().push(window);
    }
    Ok(windows)
}

#[allow(unsafe_code)]
unsafe extern "system" fn collect_window(window: HWND, lparam: LPARAM) -> BOOL {
    // SAFETY: `lparam` is the `Vec<(u32, WindowHandle)>` pointer `windows()` passed and is
    // live for the whole enumeration; every query takes the handle Windows just handed us.
    unsafe {
        let visible = IsWindowVisible(window).as_bool();
        let owner = GetWindowLongPtrW(window, GWLP_HWNDPARENT);
        let title_len = GetWindowTextLengthW(window);
        let ex_style =
            u32::try_from(GetWindowLongPtrW(window, GWL_EXSTYLE) & 0xFFFF_FFFF).unwrap_or(0);
        if is_candidate(visible, owner, title_len, ex_style) {
            let mut pid = 0_u32;
            let thread = GetWindowThreadProcessId(window, Some(&raw mut pid));
            if thread != 0 && pid != 0 {
                let found = &mut *(lparam.0 as *mut Vec<(u32, WindowHandle)>);
                found.push((pid, window.0 as isize));
            }
        }
    }
    BOOL::from(true)
}

/// Creation time of `pid` as FILETIME ticks; `None` when the process cannot be opened.
fn started_at(pid: u32) -> Option<u64> {
    // SAFETY: the handle is opened with the least privilege `GetProcessTimes` accepts and
    // closed on every path; the four `FILETIME`s are valid, writable structs.
    #[allow(unsafe_code)]
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut creation = FILETIME::default();
        let mut exit = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let result = GetProcessTimes(
            process,
            &raw mut creation,
            &raw mut exit,
            &raw mut kernel,
            &raw mut user,
        );
        close(process);
        result.ok()?;
        Some((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
    }
}

fn close(handle: HANDLE) {
    // SAFETY: `handle` was returned by `OpenProcess` and is closed exactly once here.
    #[allow(unsafe_code)]
    unsafe {
        // Best effort: a failed close cannot be acted upon.
        let _ = CloseHandle(handle);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(parent: u32, exe: &str) -> ProcessEntry {
        ProcessEntry {
            parent,
            exe: exe.to_owned(),
        }
    }

    /// `copilot` (500) inside `pwsh` (400) inside Windows Terminal (300), launched from the
    /// shell (100); the terminal owns two windows.
    fn terminal_tree() -> Snapshot {
        let mut snapshot = Snapshot::default();
        snapshot.processes.insert(100, entry(4, "explorer.exe"));
        snapshot
            .processes
            .insert(300, entry(100, "windowsterminal.exe"));
        snapshot
            .processes
            .insert(310, entry(300, "openconsole.exe"));
        snapshot.processes.insert(400, entry(300, "pwsh.exe"));
        snapshot.processes.insert(500, entry(400, "copilot.exe"));
        snapshot.processes.insert(600, entry(100, "notepad.exe"));
        snapshot.windows.insert(300, vec![0x3000, 0x3001]);
        snapshot.windows.insert(100, vec![0x1000]);
        snapshot.windows.insert(600, vec![0x6000]);
        snapshot
    }

    fn ordered_starts(pid: u32) -> Option<u64> {
        // Pid 1 started before pid 2; `None` would mean "unknown", which is its own test.
        (pid != 0).then_some(u64::from(pid))
    }

    #[test]
    fn the_cli_resolves_to_its_terminals_front_window() {
        assert_eq!(
            main_window_in(500, &terminal_tree(), ordered_starts),
            Some(0x3000)
        );
    }

    #[test]
    fn a_process_with_its_own_window_answers_it_directly() {
        assert_eq!(
            main_window_in(600, &terminal_tree(), ordered_starts),
            Some(0x6000)
        );
    }

    #[test]
    fn the_legacy_console_window_belongs_to_a_conhost_child() {
        let mut snapshot = Snapshot::default();
        snapshot.processes.insert(100, entry(4, "explorer.exe"));
        snapshot.processes.insert(400, entry(100, "pwsh.exe"));
        snapshot.processes.insert(410, entry(400, "conhost.exe"));
        snapshot.processes.insert(500, entry(400, "copilot.exe"));
        snapshot.windows.insert(410, vec![0x4100]);
        snapshot.windows.insert(100, vec![0x1000]);
        assert_eq!(main_window_in(500, &snapshot, ordered_starts), Some(0x4100));
    }

    #[test]
    fn the_walk_never_answers_the_shells_window() {
        let mut snapshot = Snapshot::default();
        snapshot.processes.insert(100, entry(4, "explorer.exe"));
        snapshot.processes.insert(500, entry(100, "copilot.exe"));
        snapshot.windows.insert(100, vec![0x1000]);
        assert_eq!(main_window_in(500, &snapshot, ordered_starts), None);
    }

    #[test]
    fn an_orphan_or_unknown_process_has_no_window() {
        let mut snapshot = Snapshot::default();
        snapshot.processes.insert(500, entry(400, "copilot.exe"));
        assert_eq!(main_window_in(500, &snapshot, ordered_starts), None);
        assert_eq!(main_window_in(999, &snapshot, ordered_starts), None);
    }

    #[test]
    fn a_parent_that_started_after_its_child_is_a_recycled_pid() {
        let snapshot = terminal_tree();
        let recycled = |pid: u32| Some(if pid == 300 { 1_000 } else { u64::from(pid) });
        assert_eq!(main_window_in(500, &snapshot, recycled), None);
        // Unknown start times are not held against the link.
        assert_eq!(main_window_in(500, &snapshot, |_| None), Some(0x3000));
    }

    #[test]
    fn the_walk_is_bounded() {
        let mut snapshot = Snapshot::default();
        for pid in 1..=20_u32 {
            snapshot.processes.insert(pid, entry(pid + 1, "node.exe"));
        }
        snapshot.processes.insert(21, entry(0, "code.exe"));
        snapshot.windows.insert(21, vec![0x2100]);
        assert_eq!(main_window_in(1, &snapshot, |_| None), None);
        assert_eq!(main_window_in(15, &snapshot, |_| None), Some(0x2100));
        let mut looped = Snapshot::default();
        looped.processes.insert(1, entry(2, "a.exe"));
        looped.processes.insert(2, entry(1, "b.exe"));
        assert_eq!(main_window_in(1, &looped, |_| None), None);
    }

    #[test]
    fn only_titled_unowned_visible_non_tool_windows_are_candidates() {
        assert!(is_candidate(true, 0, 12, 0));
        assert!(!is_candidate(false, 0, 12, 0));
        assert!(!is_candidate(true, 0x77, 12, 0));
        assert!(!is_candidate(true, 0, 0, 0));
        assert!(!is_candidate(true, 0, 12, WS_EX_TOOLWINDOW.0));
    }

    #[test]
    fn image_names_are_lower_cased_and_nul_terminated() {
        let mut buffer = [0_u16; 12];
        for (slot, c) in buffer.iter_mut().zip("PWSH.exe".encode_utf16()) {
            *slot = c;
        }
        assert_eq!(exe_name(&buffer), "pwsh.exe");
        assert_eq!(exe_name(&[0; 4]), "");
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "calls OpenProcess and GetExitCodeProcess on live processes"
    )]
    fn this_process_is_running_and_the_idle_process_is_not() {
        assert!(is_running(std::process::id()).unwrap());
        assert!(!is_running(0).unwrap());
        // The System process (pid 4) exists but cannot be opened: it counts as running.
        assert!(is_running(4).unwrap());
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "walks the live process tree and enumerates windows"
    )]
    fn the_live_snapshot_knows_this_process_and_its_parent() {
        let snapshot = Snapshot {
            processes: processes().unwrap(),
            windows: windows().unwrap(),
        };
        let me = snapshot.processes.get(&std::process::id()).unwrap();
        // `exe_name` lower-cases, so the live name ends in a lower-case extension.
        assert_eq!(me.exe, me.exe.to_lowercase());
        assert!(me.exe.contains('.'), "{}", me.exe);
        assert!(snapshot.processes.contains_key(&me.parent));
        // Whatever hosts the test runner may or may not own a window; the walk must not fail.
        let _ = main_window(std::process::id()).unwrap();
        assert!(started_at(std::process::id()).is_some());
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "calls IsWindow on a live desktop"
    )]
    fn focusing_a_stale_handle_is_not_found() {
        assert_eq!(focus(0), Err(PlatformError::NotFound("window".to_owned())));
        assert_eq!(
            focus(0x7FFF_FFF0),
            Err(PlatformError::NotFound("window".to_owned()))
        );
    }
}
