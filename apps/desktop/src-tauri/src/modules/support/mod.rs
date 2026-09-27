//! The `support` module backend (docs/modules/support.md): help and feedback links, the
//! diagnostics bundle, the two repairs, the changelog and the update channel. It owns no loop
//! and publishes nothing to the strip — everything happens on a click in the settings window
//! or the panel — so an idle module costs nothing.
//!
//! The repairs (*Restore system flyouts*, *Reset the reserved space*) act on services the
//! shell already owns (`HudService`, `ShellManager`); the composition root wires them so this
//! module never imports another module (ADR-0004). *Check for updates* is user-initiated only
//! and reads the channel's manifest through the updater plugin, also from the composition
//! root, since it needs the app handle.

pub mod bundle;
pub mod settings;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use muna_core::{Clock, Settings};
use muna_platform::{Platform, PlatformError, SystemDescription};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::{SupportSettings, UpdateChannel};

pub const ID: &str = "support";

/// The project on GitHub; every link below is relative to it.
pub const REPO_URL: &str = "https://github.com/miklol/Muna";

/// The pages *Support* opens in the browser. The URLs are built here, not in the UI, so the
/// webview never learns an address it could be talked into changing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SupportLink {
    /// The documentation.
    Help,
    /// A new issue with the system facts prefilled.
    Feedback,
    /// The repository page, where the star is.
    Rate,
    /// The release notes for the running version.
    ReleaseNotes,
}

/// The last diagnostics bundle written, for the pane's *Saved to …* row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BundleRecord {
    pub path: String,
    pub entries: u32,
    pub at_ms: i64,
}

/// Everything the pane shows (docs/modules/support.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SupportSnapshot {
    pub version: String,
    pub channel: UpdateChannel,
    pub system: SystemDescription,
    /// The profile folder; `None` in tests without one.
    pub profile_dir: Option<String>,
    /// The size of the profile's log files.
    pub logs_bytes: u64,
    pub last_bundle: Option<BundleRecord>,
    /// A `CHANGELOG.md` ships with this build, so *What's new* can show it in place.
    pub changelog: bool,
}

/// The pane's one-shot actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SupportCommand {
    /// Zips logs, settings and the system facts to the Desktop.
    Diagnostics,
    /// Hands the system flyout back to Windows, then re-applies the HUD setting.
    RepairFlyouts,
    /// Releases every `AppBar` reservation and reconciles, so Reserved mode reserves afresh.
    RepairAppBar,
    /// Opens the profile's `logs` folder in Explorer.
    OpenLogs,
    /// Reads the channel's update manifest once; never downloads.
    CheckUpdates,
}

/// What a [`SupportCommand`] produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum SupportOutcome {
    /// The command ran; nothing to show beyond that.
    Done,
    /// The diagnostics bundle was written.
    Bundle(BundleRecord),
    /// The update check answered: `version` is the newer release when there is one.
    Update {
        available: bool,
        version: Option<String>,
        notes: Option<String>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum SupportError {
    #[error(transparent)]
    Platform(#[from] PlatformError),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
    /// The update manifest could not be read (offline, or the channel has no release yet).
    #[error("update check failed: {0}")]
    Updater(String),
}

/// Where snapshot changes go (the composition root bridges this to `SupportChanged`).
pub trait SupportSink: Send + Sync {
    fn changed(&self, snapshot: &SupportSnapshot);
}

pub struct SupportService {
    platform: Arc<dyn Platform>,
    clock: Arc<dyn Clock>,
    /// The profile folder: `settings.json` and `logs/` live under it. `None` in tests.
    profile_dir: Option<PathBuf>,
    /// Where a bundled `CHANGELOG.md` may sit, in order of preference.
    changelog_candidates: Mutex<Vec<PathBuf>>,
    version: Mutex<String>,
    modules: Mutex<Vec<String>>,
    settings: Mutex<SupportSettings>,
    last_bundle: Mutex<Option<BundleRecord>>,
    sink: Mutex<Option<Arc<dyn SupportSink>>>,
}

impl std::fmt::Debug for SupportService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupportService")
            .field("profile_dir", &self.profile_dir)
            .field("settings", &*self.settings.lock())
            .field("last_bundle", &*self.last_bundle.lock())
            .finish_non_exhaustive()
    }
}

impl SupportService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        clock: Arc<dyn Clock>,
        profile_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            platform,
            clock,
            profile_dir,
            changelog_candidates: Mutex::new(Vec::new()),
            version: Mutex::new("0.0.0".into()),
            modules: Mutex::new(Vec::new()),
            settings: Mutex::new(SupportSettings::default()),
            last_bundle: Mutex::new(None),
            sink: Mutex::new(None),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn SupportSink>) {
        *self.sink.lock() = Some(sink);
    }

    /// The running version, from the app's package info (set at start-up).
    pub fn set_version(&self, version: &str) {
        version.clone_into(&mut self.version.lock());
    }

    /// The modules that started, for `system.txt`.
    pub fn set_started_modules(&self, modules: &[&str]) {
        *self.modules.lock() = modules.iter().map(|id| (*id).to_owned()).collect();
    }

    /// Where a bundled `CHANGELOG.md` may sit (the resource folder, next to the executable).
    pub fn set_changelog_candidates(&self, candidates: Vec<PathBuf>) {
        *self.changelog_candidates.lock() = candidates;
    }

    #[must_use]
    pub fn settings(&self) -> SupportSettings {
        *self.settings.lock()
    }

    /// Applies `settings.modules.support` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = SupportSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.emit_changed();
    }

    /// The settings file, when there is a profile.
    #[must_use]
    pub fn settings_file(&self) -> Option<PathBuf> {
        self.profile_dir
            .as_ref()
            .map(|dir| dir.join("settings.json"))
    }

    /// The log folder, when there is a profile.
    #[must_use]
    pub fn logs_dir(&self) -> Option<PathBuf> {
        self.profile_dir.as_ref().map(|dir| dir.join("logs"))
    }

    /// The machine facts; a platform that cannot answer reports `unknown` rather than failing
    /// the pane, since the bundle is most wanted when something is already wrong.
    #[must_use]
    pub fn system(&self) -> SystemDescription {
        match self.platform.system_info().describe() {
            Ok(system) => system,
            Err(error) => {
                tracing::warn!(%error, "system description unavailable");
                SystemDescription {
                    os: "unknown".into(),
                    webview2: None,
                }
            }
        }
    }

    #[must_use]
    pub fn snapshot(&self) -> SupportSnapshot {
        SupportSnapshot {
            version: self.version.lock().clone(),
            channel: self.settings.lock().channel,
            system: self.system(),
            profile_dir: self
                .profile_dir
                .as_ref()
                .map(|dir| dir.display().to_string()),
            logs_bytes: bundle::logs_bytes(self.logs_dir().as_deref()),
            last_bundle: self.last_bundle.lock().clone(),
            changelog: self.changelog_path().is_some(),
        }
    }

    /// Writes the diagnostics bundle to the Desktop and remembers it.
    pub fn diagnostics(&self) -> Result<BundleRecord, SupportError> {
        let desktop = self.platform.system_info().desktop_dir()?;
        let now = self.clock.system_time();
        let destination = unique_path(&desktop, &bundle_name(now));
        let monitors = self.platform.monitors().all().unwrap_or_else(|error| {
            tracing::warn!(%error, "monitor list unavailable for the bundle");
            Vec::new()
        });
        let report = bundle::SystemReport {
            version: self.version.lock().clone(),
            channel: self.settings.lock().channel,
            system: self.system(),
            monitors,
            modules: self.modules.lock().clone(),
            generated_at: chrono::DateTime::<chrono::Local>::from(now).to_rfc3339(),
        };
        let entries = bundle::write_bundle(
            &destination,
            &report,
            self.settings_file().as_deref(),
            self.logs_dir().as_deref(),
        )?;
        let record = BundleRecord {
            path: destination.display().to_string(),
            entries: u32::try_from(entries).unwrap_or(u32::MAX),
            at_ms: unix_ms(now),
        };
        tracing::info!(path = %record.path, entries, "diagnostics bundle written");
        *self.last_bundle.lock() = Some(record.clone());
        self.emit_changed();
        Ok(record)
    }

    /// The bundled changelog, when this build ships one.
    #[must_use]
    pub fn changelog(&self) -> Option<String> {
        let path = self.changelog_path()?;
        std::fs::read_to_string(path).ok()
    }

    fn changelog_path(&self) -> Option<PathBuf> {
        self.changelog_candidates
            .lock()
            .iter()
            .find(|path| path.is_file())
            .cloned()
    }

    /// The address a [`SupportLink`] opens. *Feedback* prefills the issue with the same facts
    /// `system.txt` carries, so a report is useful even without the bundle.
    #[must_use]
    pub fn link(&self, link: SupportLink) -> String {
        match link {
            SupportLink::Help => format!("{REPO_URL}/tree/main/docs#readme"),
            SupportLink::Rate => REPO_URL.to_owned(),
            SupportLink::ReleaseNotes => {
                format!("{REPO_URL}/releases/tag/v{}", self.version.lock())
            }
            SupportLink::Feedback => {
                let system = self.system();
                let body = format!(
                    "## What happened\n\n\n\n## Environment\n\n- Muna {}\n- {}\n- WebView2 {}\n",
                    self.version.lock(),
                    system.os,
                    system.webview2.as_deref().unwrap_or("not installed")
                );
                let mut url = tauri::Url::parse(REPO_URL).expect("repo url is valid");
                url.set_path("/miklol/Muna/issues/new");
                url.query_pairs_mut()
                    .append_pair("labels", "bug")
                    .append_pair("body", &body);
                url.to_string()
            }
        }
    }

    fn emit_changed(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(&self.snapshot());
        }
    }
}

/// `muna-diagnostics-YYYYMMDD-HHMM.zip` in local time, so a Desktop full of bundles sorts.
#[must_use]
pub fn bundle_name(at: SystemTime) -> String {
    let local = chrono::DateTime::<chrono::Local>::from(at);
    format!("muna-diagnostics-{}.zip", local.format("%Y%m%d-%H%M"))
}

/// `name`, or `name (2)`, `name (3)`… when the Desktop already has one from this minute.
fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = name.strip_suffix(".zip").unwrap_or(name);
    // A Desktop with a thousand bundles from one minute gets the thousandth overwritten.
    (2..1000)
        .map(|n| dir.join(format!("{stem} ({n}).zip")))
        .find(|path| !path.exists())
        .unwrap_or(candidate)
}

fn unix_ms(at: SystemTime) -> i64 {
    at.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: a settings namespace and a panel, no loop.
#[derive(Debug, Clone)]
pub struct SupportModule(pub Arc<SupportService>);

impl ModuleBackend for SupportModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
