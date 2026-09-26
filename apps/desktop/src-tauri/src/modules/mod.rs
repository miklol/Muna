//! Module backends (ADR-0004, docs/03-architecture.md "Module contract").
//!
//! A backend is a Rust struct that subscribes to platform events and publishes typed state and
//! strip content through [`ModuleCtx`]; it never touches Tauri windows or the OS directly. The
//! registry in [`backends`] is the only place a module is named — adding one is a new folder
//! here plus one line there, no shell changes.
//!
//! `start` is synchronous and spawns whatever tasks the module needs: the trait must stay
//! dyn-compatible for the registry, which `async fn` in traits is not yet.

pub mod bluetooth;
pub mod calendar;
pub mod dashboard;
pub mod day_progress;
pub mod drop_actions;
pub mod hud;
pub mod keyboard_shortcuts;
pub mod live_activities;
pub mod media;
pub mod notifications;
pub mod pomodoro;
pub mod shelf;
pub mod system_monitor;
pub mod todo;
pub mod weather;

use std::path::Path;
use std::sync::Arc;

use muna_core::{ArtCache, Clock, Hub, Store};
use muna_platform::Platform;

/// A shell surface a module can own, so the shell can route to the single owner
/// (docs/03-architecture.md "Module contract").
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Surface {
    Strip,
    Panel,
    Widget,
    Hud,
    Drop,
    Snap,
}

/// What a backend may use: the platform services and the live-activities hub.
#[derive(Clone)]
pub struct ModuleCtx {
    pub platform: Arc<dyn Platform>,
    pub activities: Arc<Hub>,
}

impl std::fmt::Debug for ModuleCtx {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModuleCtx")
            .field("platform", &self.platform.name())
            .finish_non_exhaustive()
    }
}

pub trait ModuleBackend: Send + Sync {
    /// Stable id, also the prefix of every activity id the module publishes.
    fn id(&self) -> &'static str;
    /// The surfaces this module renders into.
    fn capabilities(&self) -> &'static [Surface];
    /// Subscribes and spawns; returns once the module is running.
    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()>;
}

impl std::fmt::Debug for dyn ModuleBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModuleBackend")
            .field("id", &self.id())
            .field("capabilities", &self.capabilities())
            .finish_non_exhaustive()
    }
}

/// Module objects that outlive `start` because the IPC layer reaches them too (a backend's
/// `start` only gets a context). Created once with the app state; the registry hands each
/// backend its service.
#[derive(Debug, Clone)]
pub struct ModuleServices {
    pub media: Arc<media::MediaService>,
    pub hud: Arc<hud::HudService>,
    pub pomodoro: Arc<pomodoro::PomodoroService>,
    pub todo: Arc<todo::TodoService>,
    pub system_monitor: Arc<system_monitor::SystemMonitorService>,
    pub bluetooth: Arc<bluetooth::BluetoothService>,
    pub weather: Arc<weather::WeatherService>,
    pub calendar: Arc<calendar::CalendarService>,
    pub notifications: Arc<notifications::NotificationsService>,
    pub day_progress: Arc<day_progress::DayProgressService>,
    pub keyboard_shortcuts: Arc<keyboard_shortcuts::HotkeyService>,
    pub drop_actions: Arc<drop_actions::DropActionsService>,
    pub shelf: Arc<shelf::ShelfService>,
}

impl ModuleServices {
    /// `profile_dir` is the profile folder (module caches and Shelf storage live under it);
    /// `None` keeps caches in memory and disables Shelf copies (tests). `store` is the profile
    /// database (module tables live there); `clock` is the hub's.
    #[must_use]
    pub fn new(
        platform: &Arc<dyn Platform>,
        hub: &Arc<Hub>,
        profile_dir: Option<&Path>,
        store: &Arc<Store>,
        clock: &Arc<dyn Clock>,
    ) -> Self {
        let art_cache = profile_dir
            .map(|dir| ArtCache::new(dir.join("cache").join("art"), media::ART_CACHE_ENTRIES));
        let shelf = Arc::new(shelf::ShelfService::new(
            Arc::clone(platform),
            Arc::clone(store),
            Arc::clone(clock),
            profile_dir.map(|dir| dir.join("shelf")),
        ));
        let drop_actions = Arc::new(drop_actions::DropActionsService::new(
            Arc::clone(platform),
            Arc::clone(hub),
        ));
        // The *Shelf* tile hands its items over through the core trait (ADR-0004).
        drop_actions.set_shelf(Arc::clone(&shelf) as Arc<dyn muna_core::ShelfIntake>);
        Self {
            media: Arc::new(media::MediaService::new(
                Arc::clone(platform),
                Arc::clone(hub),
                art_cache,
            )),
            hud: Arc::new(hud::HudService::new(Arc::clone(platform), Arc::clone(hub))),
            pomodoro: Arc::new(pomodoro::PomodoroService::new(
                Arc::clone(hub),
                Arc::clone(store),
                Arc::clone(clock),
            )),
            todo: Arc::new(todo::TodoService::new(
                Arc::clone(hub),
                Arc::clone(store),
                Arc::clone(clock),
            )),
            system_monitor: Arc::new(system_monitor::SystemMonitorService::new(
                Arc::clone(platform),
                Arc::clone(hub),
                Arc::clone(clock),
            )),
            bluetooth: Arc::new(bluetooth::BluetoothService::new(
                Arc::clone(platform),
                Arc::clone(hub),
            )),
            weather: Arc::new(weather::WeatherService::new(
                Arc::clone(store),
                Arc::clone(clock),
                Arc::new(weather::OpenMeteo::new()),
            )),
            calendar: Arc::new(calendar::CalendarService::new(
                Arc::clone(store),
                Arc::clone(clock),
                Arc::clone(hub),
                Arc::clone(platform),
            )),
            notifications: Arc::new(notifications::NotificationsService::new(
                Arc::clone(platform),
                Arc::clone(hub),
            )),
            day_progress: Arc::new(day_progress::DayProgressService::new(
                Arc::clone(hub),
                Arc::clone(clock),
                Arc::new(day_progress::LocalZone),
            )),
            keyboard_shortcuts: Arc::new(keyboard_shortcuts::HotkeyService::new()),
            drop_actions,
            shelf,
        }
    }
}

/// Every backend in this build, in start order.
#[must_use]
pub fn backends(services: &ModuleServices) -> Vec<Box<dyn ModuleBackend>> {
    vec![
        Box::new(live_activities::LiveActivities),
        Box::new(dashboard::DashboardModule),
        Box::new(media::MediaModule(Arc::clone(&services.media))),
        Box::new(hud::HudModule(Arc::clone(&services.hud))),
        Box::new(pomodoro::PomodoroModule(Arc::clone(&services.pomodoro))),
        Box::new(todo::TodoModule(Arc::clone(&services.todo))),
        Box::new(system_monitor::SystemMonitorModule(Arc::clone(
            &services.system_monitor,
        ))),
        Box::new(bluetooth::BluetoothModule(Arc::clone(&services.bluetooth))),
        Box::new(weather::WeatherModule(Arc::clone(&services.weather))),
        Box::new(calendar::CalendarModule {
            service: Arc::clone(&services.calendar),
            fetcher: Arc::new(calendar::HttpIcsFetcher::new()),
        }),
        Box::new(notifications::NotificationsModule(Arc::clone(
            &services.notifications,
        ))),
        Box::new(day_progress::DayProgressModule(Arc::clone(
            &services.day_progress,
        ))),
        Box::new(keyboard_shortcuts::KeyboardShortcutsModule(Arc::clone(
            &services.keyboard_shortcuts,
        ))),
        Box::new(drop_actions::DropActionsModule(Arc::clone(
            &services.drop_actions,
        ))),
        Box::new(shelf::ShelfModule(Arc::clone(&services.shelf))),
    ]
}

/// Starts every backend; a module that fails to start is logged and skipped so one broken
/// source never takes the strip down with it.
pub fn start_all(ctx: &ModuleCtx, services: &ModuleServices) -> Vec<&'static str> {
    let mut started = Vec::new();
    for backend in backends(services) {
        match backend.start(ctx.clone()) {
            Ok(()) => {
                tracing::info!(module = backend.id(), "module started");
                started.push(backend.id());
            }
            Err(error) => {
                tracing::warn!(module = backend.id(), %error, "module failed to start");
            }
        }
    }
    started
}
