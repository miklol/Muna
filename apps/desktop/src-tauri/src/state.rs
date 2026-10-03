//! Managed application state shared by every command.

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use muna_core::{Clock, Hub, Settings, SettingsStore, Store, SystemClock};
use muna_platform::{Platform, PlatformError};
use parking_lot::Mutex;
use tauri::AppHandle;
use tauri_specta::Event;

use crate::ipc::SettingsChanged;
use crate::modules::ModuleServices;
use crate::shell::manager::ShellManager;
use crate::shell::spike::Spike;

pub struct AppState {
    pub platform: Arc<dyn Platform>,
    pub settings_store: SettingsStore,
    pub settings: Mutex<Settings>,
    /// Live activities and notices; the modules publish, the strip renders (ADR-0004).
    pub activities: Arc<Hub>,
    /// Module objects the IPC commands reach directly (ADR-0004).
    pub modules: ModuleServices,
    pub store: Arc<Store>,
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
        let store = Arc::new(Store::open(&profile_dir.join("muna.db"))?);
        let clock: Arc<dyn Clock> = Arc::new(SystemClock);
        let activities = Arc::new(Hub::new(Arc::clone(&clock)));
        let modules = ModuleServices::new(
            &platform,
            &activities,
            Some(&profile_dir.join("cache")),
            &store,
            &clock,
        );
        Ok(Self {
            platform,
            settings_store,
            settings: Mutex::new(settings),
            activities,
            modules,
            store,
            first_run,
            shell: None,
            spike: None,
        })
    }

    /// Attaches the production notch shell. `started_at` is the process start (the shell logs
    /// the cold-start time against it).
    #[must_use]
    pub fn with_shell(mut self, started_at: Instant) -> Self {
        let settings = self.settings.lock().shell.clone();
        self.shell = Some(Arc::new(ShellManager::new(
            Arc::clone(&self.platform),
            settings,
            started_at,
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
        let platform: Arc<dyn Platform> = Arc::new(muna_platform::FakePlatform::new());
        let store = Arc::new(Store::open_in_memory()?);
        let clock: Arc<dyn Clock> = Arc::new(SystemClock);
        let activities = Arc::new(Hub::new(Arc::clone(&clock)));
        let modules = ModuleServices::new(&platform, &activities, None, &store, &clock);
        Ok(Self {
            platform,
            settings_store: SettingsStore::new(profile_dir.join("settings.json")),
            settings: Mutex::new(Settings::default()),
            activities,
            modules,
            store,
            first_run: true,
            shell: None,
            spike: None,
        })
    }

    /// Everything that must follow a settings change besides saving it: the notch shell
    /// re-places its windows, launch-at-login is synced with the OS and the modules read their
    /// namespaces.
    pub fn settings_changed(self: &Arc<Self>, app: &AppHandle, settings: &Settings) {
        if let Some(shell) = &self.shell {
            shell.apply_settings(app, &settings.shell);
        }
        self.sync_autostart(app, settings.general.launch_at_login);
        self.apply_module_settings(settings);
    }

    /// Hands each module its `settings.modules.<id>` namespace.
    pub fn apply_module_settings(&self, settings: &Settings) {
        let observation = self.modules.media.apply_settings(settings);
        crate::modules::media::schedule_art(&self.modules.media, &observation);
        self.modules.hud.apply_settings(settings);
        self.modules.pomodoro.apply_settings(settings);
        self.modules.todo.apply_settings(settings);
        self.modules.system_monitor.apply_settings(settings);
        self.modules.bluetooth.apply_settings(settings);
        self.modules.weather.apply_settings(settings);
        self.modules.calendar.apply_settings(settings);
        self.modules.notifications.apply_settings(settings);
        self.modules.day_progress.apply_settings(settings);
    }

    /// Releases what the modules hold on the OS (the hidden system flyout) on a clean exit.
    pub fn shutdown_modules(&self) {
        self.modules.hud.shutdown();
    }

    /// The context handed to every module backend.
    #[must_use]
    pub fn module_ctx(&self) -> crate::modules::ModuleCtx {
        crate::modules::ModuleCtx {
            platform: Arc::clone(&self.platform),
            activities: Arc::clone(&self.activities),
        }
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
