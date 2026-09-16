//! Launch at login (docs/04-windows-platform-apis.md, docs/modules/notch-shell.md Settings):
//! `Windows.ApplicationModel.StartupTask` when the process has package identity (MSIX or an
//! external-location registration, ADR-0003), the per-user `Run` key otherwise. The identity
//! check is done once per call so an NSIS install that gains identity later just works.

use windows::ApplicationModel::{StartupTask, StartupTaskState};
use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
use windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ, RegCloseKey, RegDeleteValueW,
    RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};
use windows::core::{HSTRING, PCWSTR, w};

use super::identity;
use crate::error::{PlatformError, PlatformResult};
use crate::types::AutostartMechanism;

/// `TaskId` of the `windows.startupTask` extension in `scripts/msix/AppxManifest.xml`
/// (`identity.json` → `startupTaskId`).
pub const STARTUP_TASK_ID: &str = "MunaStartup";
/// Value name under the `Run` key.
const RUN_VALUE: PCWSTR = w!("Muna");
const RUN_KEY: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
/// Passed on the command line so the app knows it was started by the OS (no settings window).
pub const AUTOSTART_ARG: &str = "--autostart";

pub(super) fn mechanism() -> AutostartMechanism {
    match identity::current_package_full_name() {
        Ok(Some(_)) => AutostartMechanism::StartupTask,
        _ => AutostartMechanism::RunKey,
    }
}

pub(super) fn is_enabled() -> PlatformResult<bool> {
    match mechanism() {
        AutostartMechanism::StartupTask => Ok(matches!(
            startup_task()?
                .State()
                .map_err(|e| winrt("StartupTask.State", &e))?,
            StartupTaskState::Enabled | StartupTaskState::EnabledByPolicy
        )),
        _ => run_key_present(),
    }
}

pub(super) fn set_enabled(enabled: bool) -> PlatformResult<()> {
    match mechanism() {
        AutostartMechanism::StartupTask => {
            let task = startup_task()?;
            if enabled {
                let state = task
                    .RequestEnableAsync()
                    .map_err(|e| winrt("StartupTask.RequestEnableAsync", &e))?
                    .join()
                    .map_err(|e| winrt("StartupTask.RequestEnableAsync", &e))?;
                match state {
                    StartupTaskState::Enabled | StartupTaskState::EnabledByPolicy => Ok(()),
                    // The user turned it off in Task Manager / Settings > Apps > Startup; only
                    // they can turn it back on.
                    _ => Err(PlatformError::AccessDenied("startup task")),
                }
            } else {
                task.Disable().map_err(|e| winrt("StartupTask.Disable", &e))
            }
        }
        _ => {
            if enabled {
                write_run_key()
            } else {
                delete_run_key()
            }
        }
    }
}

fn startup_task() -> PlatformResult<StartupTask> {
    StartupTask::GetAsync(&HSTRING::from(STARTUP_TASK_ID))
        .map_err(|e| winrt("StartupTask.GetAsync", &e))?
        .join()
        .map_err(|e| winrt("StartupTask.GetAsync", &e))
}

fn winrt(api: &'static str, error: &windows::core::Error) -> PlatformError {
    PlatformError::Os {
        api,
        code: error.code().0.cast_unsigned(),
    }
}

/// The command the `Run` key launches: the current executable plus [`AUTOSTART_ARG`].
fn run_command() -> PlatformResult<String> {
    let exe = std::env::current_exe().map_err(|_| PlatformError::Os {
        api: "GetModuleFileNameW",
        code: 0,
    })?;
    Ok(format!("\"{}\" {AUTOSTART_ARG}", exe.display()))
}

fn open_run_key(access: windows::Win32::System::Registry::REG_SAM_FLAGS) -> PlatformResult<HKEY> {
    let mut key = HKEY::default();
    // SAFETY: `key` is a valid, writable `HKEY` out-parameter; the subkey is a `'static`
    // wide string; the status is checked.
    #[allow(unsafe_code)]
    let status = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, RUN_KEY, None, access, &raw mut key) };
    if status.is_err() {
        return Err(PlatformError::Os {
            api: "RegOpenKeyExW",
            code: status.0,
        });
    }
    Ok(key)
}

fn close(key: HKEY) {
    // SAFETY: `key` came from a successful `RegOpenKeyExW` and is closed exactly once.
    #[allow(unsafe_code)]
    let status = unsafe { RegCloseKey(key) };
    if status.is_err() {
        tracing::warn!(code = status.0, "RegCloseKey failed");
    }
}

fn run_key_present() -> PlatformResult<bool> {
    let key = open_run_key(KEY_QUERY_VALUE)?;
    // SAFETY: querying with null data and a null size only reports whether the value exists.
    #[allow(unsafe_code)]
    let status = unsafe { RegQueryValueExW(key, RUN_VALUE, None, None, None, None) };
    close(key);
    if status.is_ok() {
        Ok(true)
    } else if status == ERROR_FILE_NOT_FOUND {
        Ok(false)
    } else {
        Err(PlatformError::Os {
            api: "RegQueryValueExW",
            code: status.0,
        })
    }
}

fn write_run_key() -> PlatformResult<()> {
    let command = run_command()?;
    let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
    // `REG_SZ` data is the UTF-16 string including its terminator, as bytes.
    let bytes: Vec<u8> = wide.iter().flat_map(|c| c.to_le_bytes()).collect();
    let key = open_run_key(KEY_SET_VALUE)?;
    // SAFETY: `bytes` outlives the call and its length is passed implicitly by the slice.
    #[allow(unsafe_code)]
    let status = unsafe { RegSetValueExW(key, RUN_VALUE, None, REG_SZ, Some(&bytes)) };
    close(key);
    if status.is_err() {
        return Err(PlatformError::Os {
            api: "RegSetValueExW",
            code: status.0,
        });
    }
    Ok(())
}

fn delete_run_key() -> PlatformResult<()> {
    let key = open_run_key(KEY_SET_VALUE)?;
    // SAFETY: deleting a named value under a key we opened with `KEY_SET_VALUE`.
    #[allow(unsafe_code)]
    let status = unsafe { RegDeleteValueW(key, RUN_VALUE) };
    close(key);
    if status.is_err() && status != ERROR_FILE_NOT_FOUND {
        return Err(PlatformError::Os {
            api: "RegDeleteValueW",
            code: status.0,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_binaries_fall_back_to_the_run_key() {
        assert_eq!(mechanism(), AutostartMechanism::RunKey);
    }

    #[test]
    fn run_command_quotes_the_executable_and_adds_the_flag() {
        let command = run_command().unwrap();
        assert!(command.starts_with('"'));
        assert!(command.ends_with(&format!("\" {AUTOSTART_ARG}")));
    }

    /// Touches the real `Run` key; only meaningful on the nightly lab machine.
    #[test]
    #[cfg_attr(not(feature = "platform-tests"), ignore = "writes HKCU\\...\\Run")]
    fn run_key_round_trips() {
        let before = is_enabled().unwrap();
        set_enabled(true).unwrap();
        assert!(is_enabled().unwrap());
        set_enabled(false).unwrap();
        assert!(!is_enabled().unwrap());
        set_enabled(before).unwrap();
    }
}
