//! Managed application state shared by every command.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use muna_core::{Scheduler, Settings, SettingsStore, Store};
use muna_platform::{Platform, PlatformError};
use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::ipc::SettingsChanged;
use crate::shell::manager::ShellManager;
use crate::shell::spike::Spike;

pub struct AppState {
    pub platform: Arc<dyn Platform>,
    pub settings_store: SettingsStore,
    pub settings: Mutex<Settings>,
    pub scheduler: Mutex<Scheduler>,
    pub store: Store,
    /// `true` when no settings file existed before this launch (show the settings window).
    pub first_run: bool,
    /// The production notch shell; `None` in spike mode and in tests.
    pub shell: Option<Arc<ShellManager>>,
    /// Present only when started with `MUNA_SPIKE=window` (docs/spikes/m0-window.md).
    pub spike: Option<Arc<Spike>>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("platform", &self.platform.name())
            .field("settings_path", &self.settings_store.path())
            .field("shell", &self.shell.is_some())
            .field("spike", &self.spike.is_some())
            .finish_non_exhaustive()
    }
}

impl AppState {
    /// Opens (or creates) the profile directory, settings file and database.
    pub fn open(profile_dir: &Path, platform: Arc<dyn Platform>) -> anyhow::Result<Self> {
        std::fs::create_dir_all(profile_dir)?;
        let settings_store = SettingsStore::new(profile_dir.join("settings.json"));
        let first_run = !settings_store.path().exists();
        let settings = settings_store.load()?;
        let store = Store::open(&profile_dir.join("muna.db"))?;
        Ok(Self {
            platform,
            settings_store,
            settings: Mutex::new(settings),
            scheduler: Mutex::new(Scheduler::default()),
            store,
            first_run,
            shell: None,
            spike: None,
        })
    }

    /// Attaches the production notch shell.
    #[must_use]
    pub fn with_shell(mut self) -> Self {
        let settings = self.settings.lock().shell.clone();
        self.shell = Some(Arc::new(ShellManager::new(
            Arc::clone(&self.platform),
            settings,
        )));
        self
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
            first_run: true,
            shell: None,
            spike: None,
        })
    }

    /// Everything that must follow a settings change besides saving it: the notch shell
    /// re-places its windows and launch-at-login is synced with the OS.
    pub fn settings_changed(self: &Arc<Self>, app: &AppHandle, settings: &Settings) {
        if let Some(shell) = &self.shell {
            shell.apply_settings(app, &settings.shell);
        }
        self.sync_autostart(app, settings.general.launch_at_login);
    }

    /// Brings the OS launch-at-login state in line with the setting, off the UI thread (`WinRT`
    /// calls are joined). When Windows refuses (the user disabled the startup task in
    /// Settings), the setting is turned back off and `SettingsChanged` is emitted.
    pub fn sync_autostart(self: &Arc<Self>, app: &AppHandle, wanted: bool) {
        let state = Arc::clone(self);
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let autostart = state.platform.autostart();
            match autostart.is_enabled() {
                Ok(current) if current == wanted => return,
                Ok(_) => {}
                Err(PlatformError::Unsupported(_)) => return,
                Err(error) => {
                    tracing::warn!(%error, "autostart state unavailable");
                    return;
                }
            }
            match autostart.set_enabled(wanted) {
                Ok(()) => {
                    tracing::info!(wanted, mechanism = ?autostart.mechanism(), "autostart synced");
                }
                Err(error) => {
                    tracing::warn!(%error, wanted, "autostart update failed");
                    if wanted && matches!(error, PlatformError::AccessDenied(_)) {
                        state.revert_launch_at_login(&app);
                    }
                }
            }
        });
    }

    fn revert_launch_at_login(&self, app: &AppHandle) {
        let settings = {
            let mut settings = self.settings.lock();
            settings.general.launch_at_login = false;
            settings.clone()
        };
        if let Err(error) = self.settings_store.save(&settings) {
            tracing::warn!(%error, "settings save failed");
        }
        if let Err(error) = (SettingsChanged { settings }).emit(app) {
            tracing::warn!(%error, "failed to emit SettingsChanged");
        }
    }
}
