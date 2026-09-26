//! Tauri glue around [`ShellModel`]: creates and destroys the notch windows, bridges platform
//! events, runs the cursor and quiet-state polls, owns the tray icon, and turns model
//! [`Effect`]s into specta events. Global hotkeys belong to the keyboard-shortcuts module;
//! the shell only answers its questions (which notch is under the cursor, is one hovered) and
//! parks a display for a snooze. Everything here is safe Rust; window affinities go through
//! `muna_platform::Windowing`.
//!
//! Threading rules inherited from the M0 spike (docs/spikes/m0-window.md): the model lock is
//! never held across webview creation/destruction or `SetWindowLongPtr`; reconciles run on the
//! main thread and re-entrant requests coalesce into one more pass.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use muna_core::{DropSessions, ShellSettings};
use muna_platform::{MonitorInfo, Platform, PlatformEvent, WindowHandle};
use parking_lot::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, DragDropEvent, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_specta::Event;

use super::drag::{DragLog, DragPoint};
use super::hit_test::PollRate;
use super::memory_target::{Hold, MemoryTarget, MemoryTargetPolicy};
use super::model::{Effect, PRIMARY_LABEL, ReconcilePlan, ShellLayout, ShellModel};
use crate::ipc::{
    DropEntered, DropItem, DropLeft, DropMoved, DropPoint, Dropped, ShapeRect, ShellLayoutChanged,
    ShellPointerDownOutside, ShellYieldChanged,
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
    /// Snooze generation per monitor id; a resume only applies if no newer snooze replaced it.
    snoozes: Mutex<HashMap<String, u64>>,
    /// Earliest pending re-evaluation, so debouncing parks never piles up timers.
    recheck_at: Mutex<Option<Instant>>,
    /// Process start; the `shell ready` log line reports the cold-start time against it
    /// (docs/09-testing-qa.md, performance harness).
    started_at: Instant,
    /// Labels whose first painted frame has been logged.
    ready_reported: Mutex<HashSet<String>>,
    /// Low memory target while the cursor stays away from the notch (PRD ≤ 120 MB budget).
    memory_target: Mutex<MemoryTargetPolicy>,
    /// OLE drags in flight over the notch windows, one summary per window label.
    drags: Mutex<DragLog>,
    /// What those drags carry, for the Drop actions module (paths never reach the UI).
    drops: Arc<DropSessions>,
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
    pub fn new(
        platform: Arc<dyn Platform>,
        settings: ShellSettings,
        started_at: Instant,
        drops: Arc<DropSessions>,
    ) -> Self {
        Self {
            platform,
            model: Mutex::new(ShellModel::new(settings)),
            reconciling: AtomicBool::new(false),
            reconcile_requested: AtomicBool::new(false),
            tray: Mutex::new(None),
            snoozes: Mutex::new(HashMap::new()),
            recheck_at: Mutex::new(None),
            started_at,
            ready_reported: Mutex::new(HashSet::new()),
            memory_target: Mutex::new(MemoryTargetPolicy::new()),
            drags: Mutex::new(DragLog::default()),
            drops,
        }
    }

    /// Wires the shell into a running app. Call from `setup` (main thread).
    pub fn start(self: &Arc<Self>, app: &AppHandle) {
        if let Some(settings) = app.get_webview_window(SETTINGS_LABEL) {
            let own: Vec<WindowHandle> = handle_of(&settings).into_iter().collect();
            self.model.lock().set_own_handles(own);
            // Closing the settings window hides it; the tray brings it back (tray utility).
            let window = settings.clone();
            let manager = Arc::clone(self);
            let app_handle = app.clone();
            settings.on_window_event(move |event| match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Err(error) = window.hide() {
                        tracing::warn!(%error, "settings hide failed");
                    }
                    manager.set_memory_hold(&app_handle, Hold::SettingsFocused, false);
                }
                WindowEvent::Focused(focused) => {
                    // WebView2 creation hands the hidden settings window a focus event that
                    // no blur ever follows; only a visible window counts as in use.
                    let visible = window.is_visible().unwrap_or(false);
                    manager.set_memory_hold(
                        &app_handle,
                        Hold::SettingsFocused,
                        *focused && visible,
                    );
                }
                _ => {}
            });
        }
        self.reconcile(app);
        self.install_tray(app);
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
        self.watch_window(app, &window);
        tracing::info!(label, monitor = %monitor.id, "notch window attached");
        let effects =
            self.model
                .lock()
                .attach(self.platform.as_ref(), label, hwnd, monitor, Instant::now());
        self.apply(app, effects);
    }

    fn watch_window(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow) {
        let manager = Arc::clone(self);
        let app = app.clone();
        let label = window.label().to_owned();
        window.on_window_event(move |event| match event {
            WindowEvent::ScaleFactorChanged { .. } => {
                // tao repositions the window to the OS-suggested rect; put it back. Hop through
                // the async runtime so `run_on_main_thread` is queued, never inline.
                let manager = Arc::clone(&manager);
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    manager.request_reconcile(&app);
                });
            }
            // OLE drags reach the window through wry's drop target (docs/spikes/m4-drop.md).
            WindowEvent::DragDrop(drag) => manager.on_drag_drop(&app, &label, drag),
            // The notch never takes focus on its own (`focusable: false`); a focus gain here
            // means a drag or a click activated it, which the spike and the QA checklist watch.
            WindowEvent::Focused(true) => tracing::warn!(label, "notch window focused"),
            _ => {}
        });
    }

    /// Turns wry's drag-drop events into the typed `Drop*` events the UI renders the tiles
    /// from (docs/modules/drop-actions.md), keeps the paths in the drop registry for the
    /// module, and tells the model so the yield rules hold the strip in place meanwhile.
    fn on_drag_drop(self: &Arc<Self>, app: &AppHandle, label: &str, event: &DragDropEvent) {
        // A drag out of the notch raises these too when it passes back over the notch; the
        // Shelf must not take its own items back (docs/modules/shelf.md).
        if self.drops.self_drag_active() {
            if matches!(event, DragDropEvent::Drop { .. }) {
                tracing::info!(label, "own drag dropped on the notch; ignored");
            }
            return;
        }
        match event {
            DragDropEvent::Enter { paths, position } => {
                self.on_drag_enter(app, label, paths, position.x, position.y);
            }
            DragDropEvent::Over { position } => {
                let Some(session) = self.drops.current(label) else {
                    return;
                };
                let due = {
                    let mut drags = self.drags.lock();
                    drags.over(label, position.x, position.y);
                    drags.take_move_if_due(label, Instant::now())
                };
                if let Some(point) = due {
                    emit(
                        app,
                        &DropMoved {
                            label: label.to_owned(),
                            session,
                            position: self.css_point(label, point),
                        },
                    );
                }
            }
            DragDropEvent::Leave => {
                let summary = self.drags.lock().finish(label);
                let session = self.drops.current(label);
                self.drops.forget_window(label);
                self.end_drag(app, label);
                tracing::info!(
                    label,
                    session = session.unwrap_or_default(),
                    overs = summary.overs,
                    first = %summary.first(),
                    last = %summary.last(),
                    "drag leave"
                );
                if let Some(session) = session {
                    emit(
                        app,
                        &DropLeft {
                            label: label.to_owned(),
                            session,
                        },
                    );
                }
            }
            DragDropEvent::Drop { paths, position } => {
                let summary = self.drags.lock().finish(label);
                let session = self.drops.current(label);
                self.end_drag(app, label);
                let Some(session) = session else {
                    tracing::warn!(label, "drop without a drag session");
                    return;
                };
                self.drops.mark_dropped(session, Some(paths.clone()));
                tracing::info!(
                    label,
                    session,
                    count = paths.len(),
                    overs = summary.overs,
                    "drag drop"
                );
                emit(
                    app,
                    &Dropped {
                        label: label.to_owned(),
                        session,
                        position: self.css_point(label, DragPoint::new(position.x, position.y)),
                    },
                );
            }
            _ => {}
        }
    }

    fn end_drag(self: &Arc<Self>, app: &AppHandle, label: &str) {
        let effects =
            self.model
                .lock()
                .set_dragging(self.platform.as_ref(), label, false, Instant::now());
        self.apply(app, effects);
    }

    /// A drag entered `label`: registers the session, holds the strip and tells the UI.
    fn on_drag_enter(
        self: &Arc<Self>,
        app: &AppHandle,
        label: &str,
        paths: &[PathBuf],
        x: f64,
        y: f64,
    ) {
        let session = self.drops.begin(label, paths.to_vec());
        self.drags.lock().enter(label, x, y);
        let effects =
            self.model
                .lock()
                .set_dragging(self.platform.as_ref(), label, true, Instant::now());
        self.apply(app, effects);
        tracing::info!(label, session, count = paths.len(), "drag enter");
        let position = self.css_point(label, DragPoint::new(x, y));
        // Stat-ing the items can stall on a slow share; never on the event loop.
        let app = app.clone();
        let label = label.to_owned();
        let paths = paths.to_vec();
        tauri::async_runtime::spawn_blocking(move || {
            let items = paths.iter().map(|path| drop_item(path)).collect();
            emit(
                &app,
                &DropEntered {
                    label,
                    session,
                    items,
                    position,
                },
            );
        });
    }

    /// A drag position in physical client pixels as whole CSS pixels for the window `label`.
    fn css_point(&self, label: &str, point: DragPoint) -> DropPoint {
        let dpi = self
            .model
            .lock()
            .window(label)
            .map_or(96, |window| window.monitor.dpi.max(1));
        let scale = 96.0 / f64::from(dpi);
        // Client coordinates fit an i32 by construction; `round` then saturating casts.
        #[allow(clippy::cast_possible_truncation)]
        DropPoint {
            x: (point.x * scale).round() as i32,
            y: (point.y * scale).round() as i32,
        }
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
        let now = Instant::now();
        if self.ready_reported.lock().insert(label.to_owned()) {
            // The performance harness reads this line as "cold start to first strip paint".
            tracing::info!(
                label,
                since_start_ms = now.duration_since(self.started_at).as_millis(),
                "shell ready"
            );
        }
        let effects = self
            .model
            .lock()
            .window_ready(self.platform.as_ref(), label, now);
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

    /// The notch a global hotkey addresses: the one on the monitor under the cursor (else the
    /// primary). `None` before any window exists.
    #[must_use]
    pub fn hotkey_label(&self) -> Option<String> {
        let cursor = self
            .platform
            .windowing()
            .cursor_position()
            .unwrap_or((0, 0));
        self.model.lock().label_at(cursor)
    }

    /// `true` while the cursor is over a painted shape of some notch (strip or panel) — the
    /// *only while hovering* scope of the keyboard-shortcuts module.
    #[must_use]
    pub fn hovering(&self) -> bool {
        self.model.lock().hovered_label().is_some()
    }

    /// Parks the notch on the monitor under the cursor for `duration`, then brings it back
    /// unless a newer snooze or the tray changed the display's state meanwhile.
    pub fn snooze_under_cursor(self: &Arc<Self>, app: &AppHandle, duration: Duration) {
        let cursor = self
            .platform
            .windowing()
            .cursor_position()
            .unwrap_or((0, 0));
        let monitor_id = {
            let model = self.model.lock();
            model
                .label_at(cursor)
                .and_then(|label| model.window(&label).map(|w| w.monitor.id.clone()))
        };
        let Some(monitor_id) = monitor_id else {
            return;
        };
        let generation = {
            let mut snoozes = self.snoozes.lock();
            let generation = snoozes.get(&monitor_id).copied().unwrap_or(0) + 1;
            snoozes.insert(monitor_id.clone(), generation);
            generation
        };
        tracing::info!(monitor = %monitor_id, secs = duration.as_secs(), "notch snoozed");
        self.set_display_paused(app, &monitor_id, true);
        let manager = Arc::clone(self);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(duration).await;
            let current = manager.snoozes.lock().get(&monitor_id).copied();
            if current != Some(generation) {
                return;
            }
            manager.snoozes.lock().remove(&monitor_id);
            if manager.model.lock().paused_monitors().contains(&monitor_id) {
                manager.set_display_paused(&app, &monitor_id, false);
            }
        });
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
        let target = self.memory_target.lock().observe(poll.rate, Instant::now());
        if let Some(target) = target {
            self.apply_memory_target(app, target);
        }
        poll.rate
    }

    /// Something is about to draw or animate in a webview (strip content, hotkey): lift the low
    /// memory target now rather than at the next cursor poll.
    pub fn wake_webviews(&self, app: &AppHandle) {
        let target = self.memory_target.lock().wake();
        if let Some(target) = target {
            self.apply_memory_target(app, target);
        }
    }

    /// Keeps the webviews at the normal memory target while `hold` applies (strip content on
    /// screen, settings window focused).
    pub fn set_memory_hold(&self, app: &AppHandle, hold: Hold, active: bool) {
        tracing::debug!(hold = ?hold, active, "memory hold");
        let target = self.memory_target.lock().set_hold(hold, active);
        if let Some(target) = target {
            self.apply_memory_target(app, target);
        }
    }

    /// Asks every webview for `target`. The notch windows share one renderer with the settings
    /// window (same origin), so the trim is only meaningful applied to all of them.
    fn apply_memory_target(&self, app: &AppHandle, target: MemoryTarget) {
        let mut labels: Vec<String> = self
            .model
            .lock()
            .windows()
            .iter()
            .map(|w| w.label.clone())
            .collect();
        labels.push(SETTINGS_LABEL.to_owned());
        tracing::info!(target = ?target, windows = labels.len(), "webview memory target");
        for label in labels {
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            set_webview_memory_target(&window, target);
        }
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

/// Emits a typed event to every window, logging instead of failing.
fn emit<E: Event + serde::Serialize + Clone>(app: &AppHandle, event: &E) {
    if let Err(error) = event.emit(app) {
        tracing::warn!(%error, event = std::any::type_name::<E>(), "emit failed");
    }
}

/// What the UI may know about a dragged item: name and kind, never the path.
fn drop_item(path: &std::path::Path) -> DropItem {
    DropItem {
        name: path
            .file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned()),
        extension: path
            .extension()
            .map(|extension| extension.to_string_lossy().to_ascii_lowercase()),
        is_directory: path.is_dir(),
    }
}

/// The native handle of a Tauri window, for the platform layer.
pub fn window_handle(window: &WebviewWindow) -> Option<WindowHandle> {
    handle_of(window)
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

/// `ICoreWebView2_19::MemoryUsageTargetLevel` on one webview; runs on the webview thread.
fn set_webview_memory_target(window: &WebviewWindow, target: MemoryTarget) {
    #[cfg(windows)]
    {
        use muna_platform::windows::webview::{MemoryUsageTarget, set_memory_usage_target};
        let level = match target {
            MemoryTarget::Normal => MemoryUsageTarget::Normal,
            MemoryTarget::Low => MemoryUsageTarget::Low,
        };
        let label = window.label().to_owned();
        let result = window.with_webview(move |webview| {
            if let Err(error) = set_memory_usage_target(&webview.controller(), level) {
                tracing::warn!(%error, label, "memory target failed");
            }
        });
        if let Err(error) = result {
            tracing::warn!(%error, label = window.label(), "with_webview failed");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (window, target);
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
                Ok(PlatformEvent::MoveSizeChanged { started, .. }) => {
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
