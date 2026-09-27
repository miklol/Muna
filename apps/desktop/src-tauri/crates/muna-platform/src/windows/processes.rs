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
    CloseHandle, ERROR_ACCESS_DENIED, ERROR_INSUFFICIENT_BUFFER, ERROR_INVALID_PARAMETER, FILETIME,
    HANDLE, HWND, LPARAM, NO_ERROR, STILL_ACTIVE, WIN32_ERROR,
};
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_CONNECTIONS,
};
use windows::Win32::Networking::WinSock::AF_INET;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, GetExitCodeProcess, GetProcessTimes, OpenProcess,
    PROCESS_QUERY_LIMITED_INFORMATION,
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

/// `127.0.0.1` as the TCP table stores addresses (network byte order in a native `u32`).
const LOOPBACK: u32 = u32::from_ne_bytes([127, 0, 0, 1]);
/// Room for connections opened between the sizing call and the read.
const TABLE_HEADROOM: usize = 4096;

pub(super) fn owner_of_local_port(port: u16) -> PlatformResult<Option<u32>> {
    let family = u32::from(AF_INET.0);
    let mut size = 0_u32;
    // SAFETY: a null table with `size` 0 is the documented way to ask for the size; `size` is
    // a valid, writable `u32`.
    #[allow(unsafe_code)]
    let code = unsafe {
        GetExtendedTcpTable(
            None,
            &raw mut size,
            false,
            family,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        )
    };
    if code != NO_ERROR.0 && code != ERROR_INSUFFICIENT_BUFFER.0 {
        return Err(table_error(code));
    }
    let mut buffer = vec![0_u8; usize::try_from(size).unwrap_or(0) + TABLE_HEADROOM];
    let mut size = u32::try_from(buffer.len()).unwrap_or(u32::MAX);
    // SAFETY: `buffer` is writable for `size` bytes and both outlive the call; the table is
    // then read back through checked slices only.
    #[allow(unsafe_code)]
    let code = unsafe {
        GetExtendedTcpTable(
            Some(buffer.as_mut_ptr().cast()),
            &raw mut size,
            false,
            family,
            TCP_TABLE_OWNER_PID_CONNECTIONS,
            0,
        )
    };
    if code != NO_ERROR.0 {
        return Err(table_error(code));
    }
    let filled = usize::try_from(size).unwrap_or(0).min(buffer.len());
    Ok(owner_in(&buffer[..filled], port))
}

fn table_error(code: u32) -> PlatformError {
    PlatformError::Os {
        api: "GetExtendedTcpTable",
        code: WIN32_ERROR(code).to_hresult().0.cast_unsigned(),
    }
}

/// Finds the owner of the loopback connection bound to local `port` in a raw
/// `MIB_TCPTABLE_OWNER_PID`: a `u32` count followed by that many rows of six `u32`s
/// (state, local address, local port, remote address, remote port, owning pid). Separable
/// for tests; never reads past the slice.
#[must_use]
pub(super) fn owner_in(table: &[u8], port: u16) -> Option<u32> {
    const ROW: usize = size_of::<MIB_TCPROW_OWNER_PID>();
    let count = usize::try_from(read_u32(table, 0)?).ok()?;
    let rows = table.get(4..)?;
    rows.as_chunks::<ROW>()
        .0
        .iter()
        .take(count)
        .find_map(|row| {
            let local_addr = read_u32(row, 4)?;
            let local_port = port_of(read_u32(row, 8)?);
            let pid = read_u32(row, 20)?;
            (local_addr == LOOPBACK && local_port == port && pid != 0).then_some(pid)
        })
}

fn read_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let slice = bytes.get(at..at + 4)?;
    Some(u32::from_ne_bytes([slice[0], slice[1], slice[2], slice[3]]))
}

/// A port as the TCP table stores it: network byte order in the low 16 bits of a `u32`.
#[must_use]
pub(super) fn port_of(stored: u32) -> u16 {
    u16::from_be(u16::try_from(stored & 0xFFFF).unwrap_or(0))
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
        // Owner first: for a window of *this* process `GetWindowTextLengthW` sends
        // `WM_GETTEXTLENGTH` to the owning thread and blocks until it answers. The caller
        // may be a worker holding a lock the main thread is waiting on, and our own windows
        // are never the terminal being looked for, so they are skipped before any call that
        // can message the main thread. For other processes the length is read from the
        // window's cached caption without a message.
        let mut pid = 0_u32;
        let thread = GetWindowThreadProcessId(window, Some(&raw mut pid));
        if thread == 0 || pid == 0 || pid == GetCurrentProcessId() {
            return BOOL::from(true);
        }
        let visible = IsWindowVisible(window).as_bool();
        let owner = GetWindowLongPtrW(window, GWLP_HWNDPARENT);
        let ex_style =
            u32::try_from(GetWindowLongPtrW(window, GWL_EXSTYLE) & 0xFFFF_FFFF).unwrap_or(0);
        // Cheap, message-free checks first; the caption length only for what is left.
        if !is_candidate(visible, owner, 1, ex_style) {
            return BOOL::from(true);
        }
        let title_len = GetWindowTextLengthW(window);
        if is_candidate(visible, owner, title_len, ex_style) {
            let found = &mut *(lparam.0 as *mut Vec<(u32, WindowHandle)>);
            found.push((pid, window.0 as isize));
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

    /// One `MIB_TCPROW_OWNER_PID` as the table lays it out.
    fn row(local_addr: [u8; 4], local_port: u16, pid: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&5_u32.to_ne_bytes()); // MIB_TCP_STATE_ESTAB
        bytes.extend_from_slice(&local_addr);
        bytes.extend_from_slice(&u32::from(local_port.to_be()).to_ne_bytes());
        bytes.extend_from_slice(&[127, 0, 0, 1]);
        bytes.extend_from_slice(&u32::from(47_391_u16.to_be()).to_ne_bytes());
        bytes.extend_from_slice(&pid.to_ne_bytes());
        bytes
    }

    fn table(rows: &[Vec<u8>]) -> Vec<u8> {
        let mut bytes = u32::try_from(rows.len()).unwrap().to_ne_bytes().to_vec();
        for row in rows {
            bytes.extend_from_slice(row);
        }
        bytes
    }

    #[test]
    fn ports_are_read_from_network_byte_order() {
        assert_eq!(port_of(u32::from(53_176_u16.to_be())), 53_176);
        assert_eq!(port_of(u32::from(80_u16.to_be())), 80);
        assert_eq!(port_of(0), 0);
    }

    #[test]
    fn the_loopback_connection_on_the_port_names_its_owner() {
        let rows = [
            row([192, 168, 1, 20], 53_000, 111),
            row([127, 0, 0, 1], 53_000, 222),
            row([127, 0, 0, 1], 53_001, 333),
        ];
        assert_eq!(owner_in(&table(&rows), 53_000), Some(222));
        assert_eq!(owner_in(&table(&rows), 53_001), Some(333));
        assert_eq!(owner_in(&table(&rows), 53_002), None);
        // A count larger than the buffer never reads past it; a short buffer is no table.
        let mut oversold = table(&rows[..1]);
        oversold[..4].copy_from_slice(&9_u32.to_ne_bytes());
        assert_eq!(owner_in(&oversold, 53_001), None);
        assert_eq!(owner_in(&[1, 0], 53_000), None);
        assert_eq!(owner_in(&[], 53_000), None);
    }

    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "opens a loopback connection and reads the live TCP table"
    )]
    fn a_live_loopback_connection_belongs_to_this_process() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let client = std::net::TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (_server_side, _) = listener.accept().unwrap();
        let port = client.local_addr().unwrap().port();
        assert_eq!(owner_of_local_port(port).unwrap(), Some(std::process::id()));
        drop(client);
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

    /// A window of this process on a thread that never pumps messages: `GetWindowTextLengthW`
    /// on it would wait for ever, and `windows()` used to ask before looking at the owner.
    /// The poll that resolves an agent's terminal runs on a worker while the main thread may
    /// be waiting on the module's lock, so this is the deadlock that kept the shell from
    /// ever answering its first command.
    #[test]
    #[cfg_attr(
        not(feature = "platform-tests"),
        ignore = "creates a window and enumerates the live desktop"
    )]
    fn enumerating_never_waits_on_a_window_of_this_process() {
        use std::sync::mpsc;
        use std::time::Duration;

        use windows::Win32::Foundation::{
            ERROR_CLASS_ALREADY_EXISTS, GetLastError, HINSTANCE, LRESULT, WPARAM,
        };
        use windows::Win32::System::LibraryLoader::GetModuleHandleW;
        use windows::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, RegisterClassW, WINDOW_EX_STYLE,
            WNDCLASSW, WS_OVERLAPPED,
        };
        use windows::core::w;

        #[allow(unsafe_code)]
        unsafe extern "system" fn window_proc(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            // SAFETY: forwarding the exact arguments the OS gave us.
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }

        let (created_tx, created_rx) = mpsc::channel::<isize>();
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let owner = std::thread::spawn(move || {
            // SAFETY: the class and the window live on this thread; the window is destroyed
            // here before the thread ends and every result is checked.
            #[allow(unsafe_code)]
            unsafe {
                let module = GetModuleHandleW(None).unwrap();
                let class = WNDCLASSW {
                    lpfnWndProc: Some(window_proc),
                    hInstance: HINSTANCE(module.0),
                    lpszClassName: w!("MunaProcessesTest"),
                    ..Default::default()
                };
                if RegisterClassW(&raw const class) == 0 {
                    assert_eq!(GetLastError(), ERROR_CLASS_ALREADY_EXISTS);
                }
                let window = CreateWindowExW(
                    WINDOW_EX_STYLE(0),
                    w!("MunaProcessesTest"),
                    w!("Muna processes test"),
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
                .unwrap();
                created_tx.send(window.0 as isize).unwrap();
                // No message loop: anything sent to the window waits until this returns.
                release_rx.recv().unwrap();
                DestroyWindow(window).unwrap();
            }
        });
        let window = created_rx.recv().unwrap();

        let (done_tx, done_rx) = mpsc::channel();
        std::thread::spawn(move || {
            done_tx.send(windows()).unwrap();
        });
        let found = done_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("enumeration waited on a window of this process")
            .unwrap();
        let ours = found.get(&std::process::id()).cloned().unwrap_or_default();
        assert!(
            !ours.contains(&window),
            "this process's windows are never candidates"
        );

        release_tx.send(()).unwrap();
        owner.join().unwrap();
    }
}
