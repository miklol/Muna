// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
    }

    muna_lib::run();
    ExitCode::SUCCESS
}
