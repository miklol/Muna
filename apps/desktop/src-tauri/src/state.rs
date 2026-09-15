//! Managed application state shared by every command.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use muna_core::{Scheduler, Settings, SettingsStore, Store};
use muna_platform::Platform;
use parking_lot::Mutex;

use crate::shell::spike::Spike;

pub struct AppState {
    pub platform: Arc<dyn Platform>,
    pub settings_store: SettingsStore,
    pub settings: Mutex<Settings>,
    pub scheduler: Mutex<Scheduler>,
    pub store: Store,
    /// Present only when started with `MUNA_SPIKE=window` (docs/spikes/m0-window.md).
    pub spike: Option<Arc<Spike>>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("platform", &self.platform.name())
            .field("settings_path", &self.settings_store.path())
            .field("spike", &self.spike.is_some())
            .finish_non_exhaustive()
    }
}

impl AppState {
    /// Opens (or creates) the profile directory, settings file and database.
    pub fn open(profile_dir: &Path, platform: Arc<dyn Platform>) -> anyhow::Result<Self> {
        std::fs::create_dir_all(profile_dir)?;
        let settings_store = SettingsStore::new(profile_dir.join("settings.json"));
        let settings = settings_store.load()?;
        let store = Store::open(&profile_dir.join("muna.db"))?;
        Ok(Self {
            platform,
            settings_store,
            settings: Mutex::new(settings),
            scheduler: Mutex::new(Scheduler::default()),
            store,
            spike: None,
        })
    }

    /// Attaches the window spike (`MUNA_SPIKE=window`). `started_at` is the process start.
    #[must_use]
    pub fn with_spike(mut self, started_at: Instant, profile_dir: &Path) -> Self {
        self.spike = Some(Arc::new(Spike::new(
            Arc::clone(&self.platform),
            started_at,
            profile_dir,
        )));
        self
    }

    /// State over the fake platform and an in-memory database. Nothing is written to
    /// `profile_dir` until a command saves settings. Used by tests and tooling.
    pub fn in_memory(profile_dir: &Path) -> anyhow::Result<Self> {
        Ok(Self {
            platform: Arc::new(muna_platform::FakePlatform::new()),
            settings_store: SettingsStore::new(profile_dir.join("settings.json")),
            settings: Mutex::new(Settings::default()),
            scheduler: Mutex::new(Scheduler::default()),
            store: Store::open_in_memory()?,
            spike: None,
        })
    }
}
