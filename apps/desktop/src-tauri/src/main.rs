// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![forbid(unsafe_code)]

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        if arg == "--export-bindings" {
            let path = args
                .next()
                .map_or_else(muna_lib::ipc::default_bindings_path, PathBuf::from);
            return match muna_lib::export_bindings(&path) {
                Ok(()) => {
                    println!("wrote {}", path.display());
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("failed to export bindings: {error}");
                    ExitCode::FAILURE
                }
            };
        }
        // Must be handled before Tauri starts: the single-instance plugin would otherwise hand
        // the arguments to the running app and exit, and the watchdog would never wait.
        if arg == muna_platform::OSD_WATCHDOG_ARG {
            let Some(parent_pid) = args.next().and_then(|pid| pid.parse::<u32>().ok()) else {
                eprintln!("usage: muna {} <pid>", muna_platform::OSD_WATCHDOG_ARG);
                return ExitCode::FAILURE;
            };
            return match u8::try_from(muna_platform::run_osd_watchdog(parent_pid)) {
                Ok(code) => ExitCode::from(code),
                Err(_) => ExitCode::FAILURE,
            };
        }
    }

    muna_lib::run();
    ExitCode::SUCCESS
}
