//! Result lines: human-readable on stdout, JSON lines in `--out` for the harness.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::options::Options;

/// One probe outcome. `ok` means "behaved as the exit criterion expects *with identity*"; the
/// report's unpackaged column is allowed to be `false` where ADR-0003 predicts it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ProbeResult {
    pub id: &'static str,
    pub probe: &'static str,
    pub ok: bool,
    pub outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    pub elapsed_ms: u64,
}

impl ProbeResult {
    pub fn new(
        id: &'static str,
        probe: &'static str,
        ok: bool,
        outcome: impl Into<String>,
    ) -> Self {
        Self {
            id,
            probe,
            ok,
            outcome: outcome.into(),
            detail: None,
            elapsed_ms: 0,
        }
    }

    #[must_use]
    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    #[must_use]
    pub fn elapsed(mut self, elapsed: Duration) -> Self {
        self.elapsed_ms = millis(elapsed);
        self
    }
}

#[derive(Debug, Serialize)]
struct Note<'a> {
    id: &'static str,
    key: &'a str,
    value: &'a str,
}

#[derive(Debug)]
pub struct Reporter {
    out: Option<File>,
}

impl Reporter {
    pub fn new(out: Option<&Path>) -> io::Result<Self> {
        let out = out
            .map(|path| OpenOptions::new().create(true).append(true).open(path))
            .transpose()?;
        Ok(Self { out })
    }

    pub fn header(&mut self, options: &Options) {
        let exe = std::env::current_exe()
            .map_or_else(|_| "?".to_owned(), |path| path.display().to_string());
        let started = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|since| since.as_secs().to_string())
            .unwrap_or_default();
        self.note("exe", &exe);
        self.note("pid", &std::process::id().to_string());
        self.note("started_unix", &started);
        self.note("toast", &format!("{:?}", options.toast));
        self.note("wait_secs", &options.wait.as_secs().to_string());
    }

    pub fn note(&mut self, key: &str, value: &str) {
        println!("# {key}: {value}");
        self.write_json(&Note {
            id: "note",
            key,
            value,
        });
    }

    pub fn record(&mut self, result: &ProbeResult) {
        let mark = if result.ok { "ok " } else { "-- " };
        match &result.detail {
            Some(detail) => println!(
                "{mark}{} {}: {} ({detail}) [{} ms]",
                result.id, result.probe, result.outcome, result.elapsed_ms
            ),
            None => println!(
                "{mark}{} {}: {} [{} ms]",
                result.id, result.probe, result.outcome, result.elapsed_ms
            ),
        }
        self.write_json(result);
    }

    fn write_json<T: Serialize>(&mut self, value: &T) {
        let Some(file) = self.out.as_mut() else {
            return;
        };
        match serde_json::to_string(value) {
            Ok(line) => {
                if let Err(error) = writeln!(file, "{line}") {
                    eprintln!("muna-probe: cannot write report line: {error}");
                }
            }
            Err(error) => eprintln!("muna-probe: cannot serialise report line: {error}"),
        }
    }
}

pub fn millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn result_serialises_without_empty_detail() {
        let result = ProbeResult::new("I1", "GetCurrentPackageFullName", true, "no package")
            .elapsed(Duration::from_millis(3));
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"id\":\"I1\""));
        assert!(json.contains("\"elapsed_ms\":3"));
        assert!(!json.contains("detail"));
        let with_detail = result.detail("x");
        assert!(
            serde_json::to_string(&with_detail)
                .unwrap()
                .contains("\"detail\":\"x\"")
        );
    }

    #[test]
    fn reporter_appends_json_lines() {
        let dir = std::env::temp_dir().join(format!("muna-probe-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("report.jsonl");
        {
            let mut reporter = Reporter::new(Some(&path)).unwrap();
            reporter.note("k", "v");
            reporter.record(&ProbeResult::new("I2", "p", false, "denied"));
        }
        let lines: Vec<String> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].contains("\"key\":\"k\""));
        assert!(lines[1].contains("\"ok\":false"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
