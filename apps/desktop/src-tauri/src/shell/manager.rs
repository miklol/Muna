//! Tauri glue around [`ShellModel`]: creates and destroys the notch windows, bridges platform
//! events, runs the cursor and quiet-state polls, owns the tray icon and the toggle hotkey, and
//! turns model [`Effect`]s into specta events. Everything here is safe Rust; window affinities
//! go through `muna_platform::Windowing`.
//!
//! Threading rules inherited from the M0 spike (docs/spikes/m0-window.md): the model lock is
//! never held across webview creation/destruction or `SetWindowLongPtr`; reconciles run on the
//! main thread and re-entrant requests coalesce into one more pass.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use muna_core::ShellSettings;
use muna_platform::{MonitorInfo, Platform, PlatformEvent, WindowHandle};
use parking_lot::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_specta::Event;

use super::hit_test::PollRate;
use super::model::{Effect, PRIMARY_LABEL, ReconcilePlan, ShellLayout, ShellModel};
use crate::ipc::{
    ShapeRect, ShellLayoutChanged, ShellPointerDownOutside, ShellToggleRequested, ShellYieldChanged,
};

/// Label of the settings window in `tauri.conf.json`.
pub const SETTINGS_LABEL: &str = "settings";
const TRAY_ID: &str = "muna-tray";
const MENU_OPEN_SETTINGS: &str = "open-settings";
const MENU_QUIT: &str = "quit";
const MENU_PAUSE_PREFIX: &str = "pause:";

/// `SHQueryUserNotificationState` has no change event; 500 ms is the spec's poll period.
const QUIET_POLL: Duration = Duration::from_millis(500);
/// Follow-up top-most re-asserts after a foreground change (W12 in the spike: the activation
/// raise lands after the hook; tokio sleeps snap to the 15.6 ms timer tick).
const TOPMOST_SETTLE_SHORT: Duration = Duration::from_millis(20);
const TOPMOST_SETTLE_LONG: Duration = Duration::from_millis(250);

/// The production notch shell.
pub struct ShellManager {
    platform: Arc<dyn Platform>,
    model: Mutex<ShellModel>,
    reconciling: AtomicBool,
    reconcile_requested: AtomicBool,
    tray: Mutex<Option<TrayIcon>>,
    hotkey: Mutex<Option<String>>,
    /// Earliest pending re-evaluation, so debouncing parks never piles up timers.
    recheck_at: Mutex<Option<Instant>>,
}

impl std::fmt::Debug for ShellManager {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShellManager")
            .field("windows", &self.model.lock().windows().len())
            .finish_non_exhaustive()
    }
}

impl ShellManager {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, settings: ShellSettings) -> Self {
        Self {
            platform,
            model: Mutex::new(ShellModel::new(settings)),
            reconciling: AtomicBool::new(false),
            reconcile_requested: AtomicBool::new(false),
            tray: Mutex::new(None),
            hotkey: Mutex::new(None),
            recheck_at: Mutex::new(None),
        }
    }

    /// Wires the shell into a running app. Call from `setup` (main thread).
    pub fn start(self: &Arc<Self>, app: &AppHandle) {
        if let Some(settings) = app.get_webview_window(SETTINGS_LABEL) {
            let own: Vec<WindowHandle> = handle_of(&settings).into_iter().collect();
            self.model.lock().set_own_handles(own);
            // Closing the settings window hides it; the tray brings it back (tray utility).
            let window = settings.clone();
            settings.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        tracing::warn!(%error, "settings hide failed");
                    }
                }
            });
        }
        self.reconcile(app);
        self.install_tray(app);
        self.register_hotkey(app);
        spawn_cursor_poll(app, Arc::clone(self));
        spawn_quiet_poll(app, Arc::clone(self));
        spawn_event_bridge(app, Arc::clone(self));
    }

    /// Releases OS reservations before the process exits.
    pub fn shutdown(&self) {
        self.model.lock().release_app_bars(self.platform.as_ref());
    }

    // --- reconcile ------------------------------------------------------------------------

    /// Reconciles notch windows with the monitor list. Must run on the main thread (window
    /// creation). Re-entrant calls (wry pumps messages while it builds a webview) coalesce.
    pub fn reconcile(self: &Arc<Self>, app: &AppHandle) {
        if self.reconciling.swap(true, Ordering::AcqRel) {
            self.reconcile_requested.store(true, Ordering::Release);
            return;
        }
        loop {
            self.reconcile_once(app);
            if !self.reconcile_requested.swap(false, Ordering::AcqRel) {
                break;
            }
        }
        self.reconciling.store(false, Ordering::Release);
    }

    fn reconcile_once(self: &Arc<Self>, app: &AppHandle) {
        let monitors = match self.platform.monitors().all() {
            Ok(monitors) => monitors,
            Err(error) => {
                tracing::warn!(%error, "monitor enumeration failed");
                return;
            }
        };
        // Phase 1 (locked): plan. Phases 2–3 (unlocked): destroy, then create and attach.
        let (plan, effects): (ReconcilePlan, Vec<Effect>) =
            self.model
                .lock()
                .plan_reconcile(self.platform.as_ref(), monitors, Instant::now());
        self.apply(app, effects);
        for label in plan.destroy {
            tracing::info!(label, "notch window destroyed (monitor removed)");
            if let Some(window) = app.get_webview_window(&label)
                && let Err(error) = window.destroy()
            {
                tracing::warn!(%error, label, "destroy failed");
            }
        }
        for (label, monitor) in plan.create {
            self.attach_window(app, &label, monitor);
        }
        self.refresh_tray_menu(app);
    }

    fn attach_window(self: &Arc<Self>, app: &AppHandle, label: &str, monitor: MonitorInfo) {
        let window = match app.get_webview_window(label) {
            Some(window) => window,
            None => match create_window(app, label) {
                Ok(window) => window,
                Err(error) => {
                    tracing::error!(%error, label, "notch window creation failed");
                    return;
                }
            },
        };
        let Some(hwnd) = handle_of(&window) else {
            return;
        };
        self.watch_scale(app, &window);
        tracing::info!(label, monitor = %monitor.id, "notch window attached");
        let effects =
            self.model
                .lock()
                .attach(self.platform.as_ref(), label, hwnd, monitor, Instant::now());
        self.apply(app, effects);
    }

    fn watch_scale(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow) {
        let manager = Arc::clone(self);
        let app = app.clone();
        window.on_window_event(move |event| {
            if let WindowEvent::ScaleFactorChanged { .. } = event {
                // tao repositions the window to the OS-suggested rect; put it back. Hop through
                // the async runtime so `run_on_main_thread` is queued, never inline.
                let manager = Arc::clone(&manager);
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    manager.request_reconcile(&app);
                });
            }
        });
    }

    /// Queues a reconcile on the main thread from any thread.
    pub fn request_reconcile(self: &Arc<Self>, app: &AppHandle) {
        let manager = Arc::clone(self);
        let app_for_task = app.clone();
        if let Err(error) = app.run_on_main_thread(move || manager.reconcile(&app_for_task)) {
            tracing::warn!(%error, "run_on_main_thread failed");
        }
    }

    // --- effects --------------------------------------------------------------------------

    fn apply(self: &Arc<Self>, app: &AppHandle, effects: Vec<Effect>) {
        for effect in effects {
            match effect {
                Effect::LayoutChanged(layout) => {
                    if let Err(error) = (ShellLayoutChanged { layout }).emit(app) {
                        tracing::warn!(%error, "emit ShellLayoutChanged failed");
                    }
                }
                Effect::YieldChanged { label, state } => {
                    tracing::debug!(label, ?state, "yield");
                    if let Err(error) = (ShellYieldChanged { label, state }).emit(app) {
                        tracing::warn!(%error, "emit ShellYieldChanged failed");
                    }
                }
                Effect::RecheckAt(at) => self.schedule_recheck(app, at),
            }
        }
    }

    fn schedule_recheck(self: &Arc<Self>, app: &AppHandle, at: Instant) {
        {
            let mut pending = self.recheck_at.lock();
            if pending.is_some_and(|pending| pending <= at) {
                return;
            }
            *pending = Some(at);
        }
        let manager = Arc::clone(self);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep_until(tokio::time::Instant::from_std(at)).await;
            {
                let mut pending = manager.recheck_at.lock();
                if *pending == Some(at) {
                    *pending = None;
                }
            }
            manager.evaluate(&app);
        });
    }

    /// Re-runs the yield rules now (debounce timers, polls).
    pub fn evaluate(self: &Arc<Self>, app: &AppHandle) {
        let effects = self
            .model
            .lock()
            .evaluate(self.platform.as_ref(), Instant::now());
        self.apply(app, effects);
    }

    // --- IPC entry points -----------------------------------------------------------------

    pub fn window_ready(self: &Arc<Self>, app: &AppHandle, label: &str) {
        let effects = self
            .model
            .lock()
            .window_ready(self.platform.as_ref(), label, Instant::now());
        self.apply(app, effects);
    }

    pub fn publish_shapes(self: &Arc<Self>, app: &AppHandle, label: &str, shapes: &[ShapeRect]) {
        let effects =
            self.model
                .lock()
                .publish_shapes(self.platform.as_ref(), label, shapes, Instant::now());
        self.apply(app, effects);
    }

    #[must_use]
    pub fn shell_layout(&self, label: &str) -> Option<ShellLayout> {
        self.model.lock().shell_layout(label)
    }

    /// Toggles `WS_EX_NOACTIVATE` for one notch window. Clearing it does not activate the
    /// window by itself, so a request for focus is followed by `set_focus` (the UI asks only
    /// while Pinned with a text field focused; the window's own click cannot activate it).
    pub fn set_focusable(&self, app: &AppHandle, label: &str, focusable: bool) {
        self.model
            .lock()
            .set_focusable(self.platform.as_ref(), label, focusable);
        if focusable
            && let Some(window) = app.get_webview_window(label)
            && let Err(error) = window.set_focus()
        {
            tracing::warn!(%error, label, "set_focus failed");
        }
    }

    /// Pauses or resumes the notch on one display and mirrors it in the tray menu.
    pub fn set_display_paused(self: &Arc<Self>, app: &AppHandle, monitor_id: &str, paused: bool) {
        let effects = self.model.lock().set_paused(
            self.platform.as_ref(),
            monitor_id,
            paused,
            Instant::now(),
        );
        self.apply(app, effects);
        self.refresh_tray_menu(app);
    }

    /// New shell settings from `update_settings`.
    pub fn apply_settings(self: &Arc<Self>, app: &AppHandle, settings: &ShellSettings) {
        let effects = self.model.lock().apply_settings(
            self.platform.as_ref(),
            settings.clone(),
            Instant::now(),
        );
        self.apply(app, effects);
        self.register_hotkey(app);
    }

    /// Shows and focuses the settings window.
    pub fn open_settings(app: &AppHandle) {
        let Some(window) = app.get_webview_window(SETTINGS_LABEL) else {
            tracing::warn!("settings window missing");
            return;
        };
        if let Err(error) = window
            .show()
            .and_then(|()| window.unminimize())
            .and_then(|()| window.set_focus())
        {
            tracing::warn!(%error, "settings show failed");
        }
    }

    /// The toggle hotkey was pressed: tell the notch under the cursor.
    pub fn toggle_requested(&self, app: &AppHandle) {
        let cursor = self
            .platform
            .windowing()
            .cursor_position()
            .unwrap_or((0, 0));
        let Some(label) = self.model.lock().label_at(cursor) else {
            return;
        };
        if let Err(error) = (ShellToggleRequested { label }).emit(app) {
            tracing::warn!(%error, "emit ShellToggleRequested failed");
        }
    }

    // --- tray -----------------------------------------------------------------------------

    fn install_tray(self: &Arc<Self>, app: &AppHandle) {
        let menu = match self.build_menu(app) {
            Ok(menu) => menu,
            Err(error) => {
                tracing::error!(%error, "tray menu failed");
                return;
            }
        };
        let mut builder = TrayIconBuilder::with_id(TRAY_ID)
            .tooltip("Muna")
            .menu(&menu)
            .show_menu_on_left_click(false);
        if let Some(icon) = app.default_window_icon().cloned() {
            builder = builder.icon(icon);
        }
        let manager = Arc::clone(self);
        builder = builder
            .on_menu_event(move |app, event| manager.on_menu(app, event.id().as_ref()))
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    Self::open_settings(tray.app_handle());
                }
            });
        match builder.build(app) {
            Ok(tray) => *self.tray.lock() = Some(tray),
            Err(error) => tracing::error!(%error, "tray icon failed"),
        }
    }

    fn on_menu(self: &Arc<Self>, app: &AppHandle, id: &str) {
        match id {
            MENU_OPEN_SETTINGS => Self::open_settings(app),
            MENU_QUIT => {
                self.shutdown();
                app.exit(0);
            }
            other => {
                if let Some(monitor_id) = other.strip_prefix(MENU_PAUSE_PREFIX) {
                    let paused = !self.model.lock().paused_monitors().contains(monitor_id);
                    self.set_display_paused(app, monitor_id, paused);
                }
            }
        }
    }

    fn build_menu(&self, app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
        let (monitors, paused) = {
            let model = self.model.lock();
            (model.monitors().to_vec(), model.paused_monitors().clone())
        };
        let open = MenuItem::with_id(app, MENU_OPEN_SETTINGS, "Open settings", true, None::<&str>)?;
        let pause = Submenu::with_id(app, "pause", "Pause on display", true)?;
        for monitor in &monitors {
            let item = CheckMenuItem::with_id(
                app,
                format!("{MENU_PAUSE_PREFIX}{}", monitor.id),
                display_name(monitor),
                true,
                paused.contains(&monitor.id),
                None::<&str>,
            )?;
            pause.append(&item)?;
        }
        let quit = MenuItem::with_id(app, MENU_QUIT, "Quit Muna", true, None::<&str>)?;
        Menu::with_items(
            app,
            &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit],
        )
    }

    fn refresh_tray_menu(&self, app: &AppHandle) {
        let tray = self.tray.lock();
        let Some(tray) = tray.as_ref() else {
            return;
        };
        match self.build_menu(app) {
            Ok(menu) => {
                if let Err(error) = tray.set_menu(Some(menu)) {
                    tracing::warn!(%error, "tray menu update failed");
                }
            }
            Err(error) => tracing::warn!(%error, "tray menu rebuild failed"),
        }
    }

    // --- hotkey ---------------------------------------------------------------------------

    fn register_hotkey(self: &Arc<Self>, app: &AppHandle) {
        let wanted = self.model.lock().settings().toggle_hotkey.clone();
        let mut current = self.hotkey.lock();
        if current.as_deref() == Some(wanted.as_str()) {
            return;
        }
        if let Some(previous) = current.take()
            && let Err(error) = app.global_shortcut().unregister(previous.as_str())
        {
            tracing::warn!(%error, keys = previous, "hotkey unregister failed");
        }
        if wanted.trim().is_empty() {
            return;
        }
        let manager = Arc::clone(self);
        let result =
            app.global_shortcut()
                .on_shortcut(wanted.as_str(), move |app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        manager.toggle_requested(app);
                    }
                });
        match result {
            Ok(()) => *current = Some(wanted),
            Err(error) => tracing::warn!(%error, keys = wanted, "hotkey registration failed"),
        }
    }

    // --- polls ----------------------------------------------------------------------------

    fn poll_cursor(&self, app: &AppHandle) -> PollRate {
        let windowing = self.platform.windowing();
        let cursor = match windowing.cursor_position() {
            Ok(cursor) => cursor,
            Err(error) => {
                tracing::warn!(%error, "cursor poll failed");
                return PollRate::Idle;
            }
        };
        let button_down = windowing.pointer_button_down().unwrap_or_else(|error| {
            tracing::warn!(%error, "pointer button poll failed");
            false
        });
        let poll = self.model.lock().poll_cursor(cursor, button_down);
        // Outside the lock: `SetWindowLongPtr` is a synchronous message to the main thread,
        // which may itself be waiting for the model (docs/spikes/m0-window.md, W7).
        for (hwnd, ignore) in poll.toggles {
            if let Err(error) = windowing.set_click_through(hwnd, ignore) {
                tracing::warn!(%error, "set_click_through failed");
            }
        }
        for label in poll.pressed_outside {
            if let Err(error) = (ShellPointerDownOutside { label }).emit(app) {
                tracing::warn!(%error, "emit ShellPointerDownOutside failed");
            }
        }
        poll.rate
    }

    fn assert_all_topmost(&self) {
        let model = self.model.lock();
        for window in model.windows().iter().filter(|w| w.ready) {
            if let Err(error) = self.platform.windowing().assert_topmost(window.hwnd) {
                tracing::warn!(%error, label = window.label, "assert_topmost failed");
            }
        }
    }

    fn refresh_foreground(self: &Arc<Self>, app: &AppHandle) {
        match self.platform.foreground().current() {
            Ok(foreground) => {
                let effects = self.model.lock().set_foreground(
                    self.platform.as_ref(),
                    foreground,
                    Instant::now(),
                );
                self.apply(app, effects);
            }
            Err(error) => tracing::warn!(%error, "foreground snapshot failed"),
        }
    }
}

/// `\\.\DISPLAY2` → "Display 2", with "(primary)" where it applies.
fn display_name(monitor: &MonitorInfo) -> String {
    let number = monitor
        .id
        .trim_start_matches(|c: char| !c.is_ascii_digit())
        .to_owned();
    let mut name = if number.is_empty() {
        monitor.id.clone()
    } else {
        format!("Display {number}")
    };
    if monitor.is_primary {
        name.push_str(" (primary)");
    }
    name
}

/// Builds a secondary notch window from the config of the primary one, relabelled.
fn create_window(app: &AppHandle, label: &str) -> anyhow::Result<WebviewWindow> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == PRIMARY_LABEL)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("no `{PRIMARY_LABEL}` window in tauri.conf.json"))?;
    label.clone_into(&mut config.label);
    Ok(WebviewWindowBuilder::from_config(app, &config)?.build()?)
}

fn handle_of(window: &WebviewWindow) -> Option<WindowHandle> {
    #[cfg(windows)]
    {
        match window.hwnd() {
            Ok(hwnd) => Some(hwnd.0 as WindowHandle),
            Err(error) => {
                tracing::warn!(%error, label = window.label(), "hwnd unavailable");
                None
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}

fn spawn_cursor_poll(app: &AppHandle, manager: Arc<ShellManager>) {
    // A plain OS thread, not a tokio task: tokio's timer parks on the 15.6 ms Windows tick
    // (measured 31 ms for a 16.7 ms sleep), while `std::thread::sleep` uses a high-resolution
    // waitable timer without raising the process timer resolution.
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("muna-cursor-poll".into())
        .spawn(move || {
            loop {
                let rate = manager.poll_cursor(&app);
                std::thread::sleep(rate.interval());
            }
        });
    if let Err(error) = spawned {
        tracing::error!(%error, "cursor poll thread failed to start");
    }
}

fn spawn_quiet_poll(app: &AppHandle, manager: Arc<ShellManager>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(QUIET_POLL).await;
            match manager.platform.windowing().user_notification_state() {
                Ok(state) => {
                    let effects = manager.model.lock().set_quiet(
                        manager.platform.as_ref(),
                        state,
                        Instant::now(),
                    );
                    manager.apply(&app, effects);
                }
                Err(error) => tracing::warn!(%error, "quiet state poll failed"),
            }
            // A window going fullscreen or maximised raises no foreground event; re-sample.
            manager.refresh_foreground(&app);
        }
    });
}

fn spawn_event_bridge(app: &AppHandle, manager: Arc<ShellManager>) {
    let app = app.clone();
    let mut events = manager.platform.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(PlatformEvent::ForegroundChanged(foreground)) => {
                    // Three re-asserts: the system raises the newly activated window *after*
                    // delivering EVENT_SYSTEM_FOREGROUND (W12, docs/spikes/m0-window.md).
                    manager.assert_all_topmost();
                    let effects = manager.model.lock().set_foreground(
                        manager.platform.as_ref(),
                        Some(foreground),
                        Instant::now(),
                    );
                    manager.apply(&app, effects);
                    let manager = Arc::clone(&manager);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(TOPMOST_SETTLE_SHORT).await;
                        manager.assert_all_topmost();
                        tokio::time::sleep(
                            TOPMOST_SETTLE_LONG.saturating_sub(TOPMOST_SETTLE_SHORT),
                        )
                        .await;
                        manager.assert_all_topmost();
                    });
                }
                Ok(PlatformEvent::MoveSizeChanged { started }) => {
                    let effects = manager.model.lock().set_moving(
                        manager.platform.as_ref(),
                        started,
                        Instant::now(),
                    );
                    manager.apply(&app, effects);
                    if !started {
                        // The dragged window may now sit under the strip.
                        manager.refresh_foreground(&app);
                    }
                }
                Ok(PlatformEvent::SessionLockChanged { locked }) => {
                    let effects = manager.model.lock().set_locked(
                        manager.platform.as_ref(),
                        locked,
                        Instant::now(),
                    );
                    manager.apply(&app, effects);
                }
                Ok(PlatformEvent::MonitorsChanged(monitors)) => {
                    tracing::info!(count = monitors.len(), "display change");
                    manager.request_reconcile(&app);
                }
                Ok(_) => {}
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "platform events lagged");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}
