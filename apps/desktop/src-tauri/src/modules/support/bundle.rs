//! The diagnostics bundle (docs/modules/support.md): one zip on the Desktop with everything a
//! bug report needs and nothing that identifies the user. Contents:
//!
//! - `README.txt` — what is inside and what is not;
//! - `system.txt` — app version and channel, OS build, `WebView2` runtime, monitor topology,
//!   the modules that started;
//! - `settings.json` — the settings document as saved. It holds no secrets by design: every
//!   token and feed address lives in Credential Manager (`Secrets`), never in the file;
//! - `logs/*.log` — the profile's log files (the log plugin keeps five of at most 5 MB each,
//!   and never logs tokens or notification bodies).

use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

use muna_platform::{MonitorInfo, SystemDescription};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::{SupportError, UpdateChannel};

/// What `system.txt` is rendered from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SystemReport {
    pub version: String,
    pub channel: UpdateChannel,
    pub system: SystemDescription,
    pub monitors: Vec<MonitorInfo>,
    pub modules: Vec<String>,
    /// RFC 3339 local time the bundle was made.
    pub generated_at: String,
}

/// The `system.txt` text: one fact per line, so a maintainer reads it in the issue.
#[must_use]
pub fn render_system_report(report: &SystemReport) -> String {
    use std::fmt::Write as _;
    let channel = match report.channel {
        UpdateChannel::Stable => "stable",
        UpdateChannel::Beta => "beta",
    };
    let mut text = String::new();
    // Writing to a `String` cannot fail.
    let _ = writeln!(text, "Muna {} ({channel} channel)", report.version);
    let _ = writeln!(text, "OS: {}", report.system.os);
    let _ = writeln!(
        text,
        "WebView2: {}",
        report.system.webview2.as_deref().unwrap_or("not installed")
    );
    let _ = writeln!(text, "Monitors: {}", report.monitors.len());
    for monitor in &report.monitors {
        let _ = writeln!(
            text,
            "  {} {}x{} at ({}, {}) dpi {}{}",
            monitor.id,
            monitor.bounds.width,
            monitor.bounds.height,
            monitor.bounds.x,
            monitor.bounds.y,
            monitor.dpi,
            if monitor.is_primary { " primary" } else { "" }
        );
    }
    let _ = writeln!(text, "Modules: {}", report.modules.join(", "));
    let _ = writeln!(text, "Generated: {}", report.generated_at);
    text
}

const README: &str = "Muna diagnostics bundle

This bundle was made by Muna > Settings > Support > Save diagnostics. Attach it to a GitHub
issue at https://github.com/miklol/Muna/issues.

Inside:
  system.txt     app version, Windows build, WebView2 runtime, monitors, running modules
  settings.json  your settings as saved (integration tokens and feed addresses are kept in
                 Windows Credential Manager and are not in this file)
  logs/          Muna's own log files; they never contain tokens or notification text

Nothing here identifies you or your account. Read it before you share it if in doubt.
";

/// Writes the bundle to `destination` and answers the number of entries written.
pub fn write_bundle(
    destination: &Path,
    report: &SystemReport,
    settings_file: Option<&Path>,
    logs_dir: Option<&Path>,
) -> Result<usize, SupportError> {
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut writer = ZipWriter::new(File::create(destination)?);
    let mut entries = 0;

    writer.start_file("README.txt", options)?;
    writer.write_all(README.as_bytes())?;
    entries += 1;

    writer.start_file("system.txt", options)?;
    writer.write_all(render_system_report(report).as_bytes())?;
    entries += 1;

    if let Some(settings) = settings_file
        && let Ok(bytes) = std::fs::read(settings)
    {
        writer.start_file("settings.json", options)?;
        writer.write_all(&bytes)?;
        entries += 1;
    }

    for log in log_files(logs_dir) {
        let Some(name) = log.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        // A log the plugin is writing right now still reads; a vanished one is skipped.
        let Ok(bytes) = std::fs::read(&log) else {
            continue;
        };
        writer.start_file(format!("logs/{name}"), options)?;
        writer.write_all(&bytes)?;
        entries += 1;
    }

    writer.finish()?;
    Ok(entries)
}

/// The `*.log` files under `logs_dir`, sorted by name so rotated files keep their order.
#[must_use]
pub fn log_files(logs_dir: Option<&Path>) -> Vec<PathBuf> {
    let Some(dir) = logs_dir else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "log") && path.is_file())
        .collect();
    files.sort();
    files
}

/// The size of every `*.log` file under `logs_dir`, for the pane's *Logs* row.
#[must_use]
pub fn logs_bytes(logs_dir: Option<&Path>) -> u64 {
    log_files(logs_dir)
        .iter()
        .filter_map(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len())
        .sum()
}
