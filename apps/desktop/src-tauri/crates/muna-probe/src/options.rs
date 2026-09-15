//! Command-line options. Hand-rolled on purpose: the probe must stay dependency-light so it
//! builds in seconds on the lab machine and inside the release pipeline's Rust cache.

use std::path::PathBuf;
use std::time::Duration;

/// Where the test toast for I3/I4 comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToastSource {
    /// `ToastNotificationManager.CreateToastNotifierWithId(aumid)`: any registered Start-menu
    /// application. The default is Windows PowerShell, which every machine has, so the toast
    /// is a *foreign* notification — the case the Notifications module cares about.
    Aumid(String),
    /// `CreateToastNotifier()` with the current process' own identity (packaged runs only).
    SelfIdentity,
    /// Do not send anything; I4 then measures whatever the user does within `--wait-secs`.
    None,
}

/// Windows PowerShell's `AppUserModelID`, registered by the OS on every install.
pub const POWERSHELL_AUMID: &str =
    r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe";

/// `TaskId` of the `windows.startupTask` extension in `scripts/msix/AppxManifest.xml`.
pub const DEFAULT_STARTUP_TASK_ID: &str = "MunaStartup";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Options {
    /// JSON-lines report file (appended); stdout always gets the human-readable lines.
    pub out: Option<PathBuf>,
    pub toast: ToastSource,
    /// How long I4 waits for `NotificationChanged` after the toast (exit criterion: 10 s).
    pub wait: Duration,
    /// How long calls that may show a consent prompt (I2, I5, I6) may block.
    pub prompt_wait: Duration,
    pub startup_task_id: String,
    /// I5 flips the startup task Enabled ↔ Disabled and restores the initial state.
    pub toggle_startup: bool,
}

impl Options {
    pub const USAGE: &'static str = "\
usage: muna-probe [options]

  --out <file>              append JSON lines to <file> (stdout is always written)
  --toast-aumid <aumid>     app that sends the test toast (default: Windows PowerShell)
  --toast self|none         use the process' own identity, or send no toast
  --wait-secs <n>           NotificationChanged deadline after the toast (default 10)
  --prompt-secs <n>         deadline for calls that may prompt for consent (default 30)
  --startup-task-id <id>    windows.startupTask TaskId (default MunaStartup)
  --no-toggle-startup       only read the startup task state
  --help";

    /// `Ok(None)` means `--help` was requested.
    pub fn parse<I: IntoIterator<Item = String>>(args: I) -> Result<Option<Self>, String> {
        let mut options = Self::default();
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            let mut value = |name: &str| args.next().ok_or_else(|| format!("{name} needs a value"));
            match arg.as_str() {
                "--help" | "-h" => return Ok(None),
                "--out" => options.out = Some(PathBuf::from(value("--out")?)),
                "--toast-aumid" => options.toast = ToastSource::Aumid(value("--toast-aumid")?),
                "--toast" => {
                    options.toast = match value("--toast")?.as_str() {
                        "self" => ToastSource::SelfIdentity,
                        "none" => ToastSource::None,
                        other => return Err(format!("--toast expects self or none, got {other}")),
                    }
                }
                "--wait-secs" => options.wait = parse_secs("--wait-secs", &value("--wait-secs")?)?,
                "--prompt-secs" => {
                    options.prompt_wait = parse_secs("--prompt-secs", &value("--prompt-secs")?)?;
                }
                "--startup-task-id" => options.startup_task_id = value("--startup-task-id")?,
                "--no-toggle-startup" => options.toggle_startup = false,
                other => return Err(format!("unknown argument {other}")),
            }
        }
        Ok(Some(options))
    }
}

impl Default for Options {
    fn default() -> Self {
        Self {
            out: None,
            toast: ToastSource::Aumid(POWERSHELL_AUMID.to_owned()),
            wait: Duration::from_secs(10),
            prompt_wait: Duration::from_secs(30),
            startup_task_id: DEFAULT_STARTUP_TASK_ID.to_owned(),
            toggle_startup: true,
        }
    }
}

fn parse_secs(name: &str, value: &str) -> Result<Duration, String> {
    value
        .parse::<u64>()
        .map(Duration::from_secs)
        .map_err(|_| format!("{name} expects a whole number of seconds, got {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Option<Options>, String> {
        Options::parse(args.iter().map(|arg| (*arg).to_owned()))
    }

    #[test]
    fn defaults_target_a_foreign_toast_and_the_ten_second_criterion() {
        let options = parse(&[]).unwrap().unwrap();
        assert_eq!(
            options.toast,
            ToastSource::Aumid(POWERSHELL_AUMID.to_owned())
        );
        assert_eq!(options.wait, Duration::from_secs(10));
        assert!(options.toggle_startup);
        assert_eq!(options.startup_task_id, DEFAULT_STARTUP_TASK_ID);
    }

    #[test]
    fn parses_every_option() {
        let options = parse(&[
            "--out",
            "report.jsonl",
            "--toast",
            "self",
            "--wait-secs",
            "3",
            "--prompt-secs",
            "5",
            "--startup-task-id",
            "Other",
            "--no-toggle-startup",
        ])
        .unwrap()
        .unwrap();
        assert_eq!(options.out, Some(PathBuf::from("report.jsonl")));
        assert_eq!(options.toast, ToastSource::SelfIdentity);
        assert_eq!(options.wait, Duration::from_secs(3));
        assert_eq!(options.prompt_wait, Duration::from_secs(5));
        assert_eq!(options.startup_task_id, "Other");
        assert!(!options.toggle_startup);
    }

    #[test]
    fn help_and_errors() {
        assert_eq!(parse(&["--help"]), Ok(None));
        assert!(parse(&["--wait-secs", "soon"]).is_err());
        assert!(parse(&["--toast", "maybe"]).is_err());
        assert!(parse(&["--out"]).is_err());
        assert!(parse(&["--bogus"]).is_err());
    }
}
