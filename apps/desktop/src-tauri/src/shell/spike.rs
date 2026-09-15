//! The M0-E2 window spike (docs/spikes/m0-window.md): drives the real notch window through the
//! ADR-0002 assumptions and writes every observation to `%LOCALAPPDATA%\Muna\spike\window.jsonl`
//! so `scripts/perf/window-spike` can correlate them with external measurements.
//!
//! Enabled with `MUNA_SPIKE=window`. Knobs (all optional): `MUNA_SPIKE_CYCLES=n` runs *n*
//! park/unpark cycles after the UI is ready, `MUNA_SPIKE_MORPHS=n` requests *n* strip ↔ panel
//! morphs, `MUNA_SPIKE_EXCLUDE_CAPTURE=1` sets `WDA_EXCLUDEFROMCAPTURE` at start. Global
//! shortcuts: `Ctrl+Alt+M` morph, `Ctrl+Alt+P` park, `Ctrl+Alt+C` capture exclusion.
//!
//! Everything here is safe Rust: window affinities go through `muna_platform::Windowing`.

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use muna_platform::{MonitorInfo, Platform, PlatformEvent, Rect, WindowHandle};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_specta::Event;

use super::hit_test::{HitTester, PollRate};
use super::layout;
use crate::ipc::{MorphReport, MorphRequested, ShapeRect};

/// Label of the window declared in `tauri.conf.json`; secondary monitors get `notch-<n>`.
pub const PRIMARY_LABEL: &str = "notch";

const QUIET_POLL: Duration = Duration::from_millis(500);
/// Follow-up top-most re-asserts after a foreground change (the activation raise races the
/// hook; tokio sleeps land on the next 15.6 ms timer tick, so the short one is ≈ 2 ticks).
const TOPMOST_SETTLE_SHORT: Duration = Duration::from_millis(20);
const TOPMOST_SETTLE_LONG: Duration = Duration::from_millis(250);
const CYCLE_HALF_PERIOD: Duration = Duration::from_millis(250);
const MORPH_PERIOD: Duration = Duration::from_millis(1200);

const WS_EX_TOPMOST: u32 = 0x0000_0008;
const WS_EX_TRANSPARENT: u32 = 0x0000_0020;
const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
const WS_EX_APPWINDOW: u32 = 0x0004_0000;
const WS_EX_LAYERED: u32 = 0x0008_0000;
const WS_EX_NOACTIVATE: u32 = 0x0800_0000;

/// `true` when the process was started with `MUNA_SPIKE=window`.
#[must_use]
pub fn enabled() -> bool {
    std::env::var("MUNA_SPIKE").is_ok_and(|value| value == "window")
}

fn env_count(name: &str) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0)
}

/// One notch window and what the spike knows about it.
#[derive(Debug)]
struct NotchWindow {
    label: String,
    hwnd: WindowHandle,
    monitor: MonitorInfo,
    /// Where the window is right now (placed or parked).
    rect: Rect,
    ready: bool,
    /// Last shapes published by the UI, CSS px relative to the client area.
    css_shapes: Vec<ShapeRect>,
    hit_tester: HitTester,
}

/// Spike state shared by IPC commands, timers and shortcut handlers.
pub struct Spike {
    platform: Arc<dyn Platform>,
    started_at: Instant,
    log: Mutex<Option<File>>,
    windows: Mutex<Vec<NotchWindow>>,
    /// Labels whose webview reported ready before the window was attached.
    early_ready: Mutex<HashSet<String>>,
    /// Shapes published before the window was attached (the UI publishes once at ready).
    early_shapes: Mutex<HashMap<String, Vec<ShapeRect>>>,
    next_label: Mutex<u32>,
    reconciling: AtomicBool,
    reconcile_requested: AtomicBool,
    parked: AtomicBool,
    expanded: AtomicBool,
    capture_excluded: AtomicBool,
}

impl std::fmt::Debug for Spike {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Spike")
            .field("windows", &self.windows.lock().len())
            .field("parked", &self.parked.load(Ordering::Relaxed))
            .finish_non_exhaustive()
    }
}

#[derive(Serialize)]
struct LogLine<'a, T: Serialize> {
    t_ms: f64,
    event: &'a str,
    #[serde(flatten)]
    data: T,
}

impl Spike {
    /// Creates the spike state. `started_at` is the process start, for time-to-first-paint.
    pub fn new(platform: Arc<dyn Platform>, started_at: Instant, profile_dir: &Path) -> Self {
        let log = open_log(&profile_dir.join("spike").join("window.jsonl"));
        Self {
            platform,
            started_at,
            log: Mutex::new(log),
            windows: Mutex::new(Vec::new()),
            early_ready: Mutex::new(HashSet::new()),
            early_shapes: Mutex::new(HashMap::new()),
            next_label: Mutex::new(1),
            reconciling: AtomicBool::new(false),
            reconcile_requested: AtomicBool::new(false),
            parked: AtomicBool::new(false),
            expanded: AtomicBool::new(false),
            capture_excluded: AtomicBool::new(false),
        }
    }

    fn elapsed_ms(&self) -> f64 {
        self.started_at.elapsed().as_secs_f64() * 1000.0
    }

    /// Appends one JSONL line and mirrors it to tracing.
    fn log<T: Serialize>(&self, event: &str, data: T) {
        let line = LogLine {
            t_ms: self.elapsed_ms(),
            event,
            data,
        };
        match serde_json::to_string(&line) {
            Ok(json) => {
                tracing::info!(target: "muna::spike", "{json}");
                if let Some(file) = self.log.lock().as_mut()
                    && let Err(error) = writeln!(file, "{json}")
                {
                    tracing::warn!(%error, "spike log write failed");
                }
            }
            Err(error) => tracing::warn!(%error, "spike log serialisation failed"),
        }
    }

    fn windowing(&self) -> &dyn muna_platform::Windowing {
        self.platform.windowing()
    }

    /// Reconciles notch windows with the current monitor list: the config `notch` window
    /// follows the primary monitor, every other monitor gets its own `notch-<n>` window, and
    /// windows whose monitor vanished are destroyed. Must run on the main thread (window
    /// creation). Re-entrant calls (wry pumps messages while it builds a webview, which can
    /// dispatch a queued `run_on_main_thread` reconcile) are coalesced into one more pass.
    fn reconcile(self: &Arc<Self>, app: &AppHandle) {
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
                self.log(
                    "monitors_error",
                    serde_json::json!({ "error": error.to_string() }),
                );
                return;
            }
        };
        self.log("monitors", serde_json::json!({ "monitors": &monitors }));

        // Phase 1 (locked): refresh known windows and decide which labels need a window. The
        // lock is never held across window creation or destruction: both pump messages, and an
        // IPC command (`shell_ready`) arriving in that pump needs the same lock (deadlock seen
        // in the first spike run).
        let mut pending: Vec<(String, MonitorInfo)> = Vec::new();
        let mut assigned: Vec<String> = Vec::new();
        let mut stale: Vec<String> = Vec::new();
        {
            let mut windows = self.windows.lock();
            for monitor in &monitors {
                let label = if monitor.is_primary {
                    PRIMARY_LABEL.to_owned()
                } else if let Some(existing) = windows
                    .iter()
                    .find(|w| w.label != PRIMARY_LABEL && w.monitor.id == monitor.id)
                {
                    existing.label.clone()
                } else {
                    let mut next = self.next_label.lock();
                    let label = format!("{PRIMARY_LABEL}-{next}");
                    *next += 1;
                    label
                };
                assigned.push(label.clone());

                if let Some(existing) = windows.iter_mut().find(|w| w.label == label) {
                    existing.monitor = monitor.clone();
                    if existing.ready {
                        let rect = self.target_rect(monitor);
                        self.move_window(existing, rect);
                    }
                } else {
                    pending.push((label, monitor.clone()));
                }
            }
            windows.retain(|w| {
                if assigned.contains(&w.label) || w.label == PRIMARY_LABEL {
                    return true;
                }
                stale.push(w.label.clone());
                false
            });
        }

        // Phase 2 (unlocked): destroy windows whose monitor vanished.
        for label in stale {
            self.log("window_destroyed", serde_json::json!({ "label": label }));
            if let Some(window) = app.get_webview_window(&label)
                && let Err(error) = window.destroy()
            {
                tracing::warn!(%error, label, "destroy failed");
            }
        }

        // Phase 3 (unlocked creation, short lock to register): attach or create windows.
        for (label, monitor) in pending {
            self.attach_window(app, label, monitor);
        }
    }

    /// Creates (or adopts) the webview window for `label`, registers it and replays anything
    /// the UI reported before the window was attached.
    fn attach_window(self: &Arc<Self>, app: &AppHandle, label: String, monitor: MonitorInfo) {
        let window = match app.get_webview_window(&label) {
            Some(window) => window,
            None => match create_window(app, &label) {
                Ok(window) => window,
                Err(error) => {
                    self.log(
                        "window_create_error",
                        serde_json::json!({ "label": label, "error": error.to_string() }),
                    );
                    return;
                }
            },
        };
        let Some(hwnd) = handle_of(&window) else {
            return;
        };
        self.watch_scale(app, &window);
        self.log(
            "window_attached",
            serde_json::json!({ "label": label, "monitor": monitor.id, "hwnd": hwnd }),
        );
        let mut windows = self.windows.lock();
        if windows.iter().any(|w| w.label == label) {
            return;
        }
        // The webview may have reported shapes and ready before the spike attached its
        // window (it does when the page loads faster than the shell sets up).
        let early_shapes = self.early_shapes.lock().remove(&label);
        let early_ready = self.early_ready.lock().remove(&label);
        windows.push(NotchWindow {
            label,
            hwnd,
            monitor,
            rect: Rect::default(),
            ready: false,
            css_shapes: Vec::new(),
            hit_tester: HitTester::new(),
        });
        let Some(window) = windows.last_mut() else {
            return;
        };
        if let Some(shapes) = early_shapes {
            window.css_shapes = shapes;
            Self::refresh_shapes(window);
            self.log_shapes(window);
        }
        if early_ready {
            self.mark_ready(window);
        }
    }

    fn watch_scale(self: &Arc<Self>, app: &AppHandle, window: &WebviewWindow) {
        let spike = Arc::clone(self);
        let app = app.clone();
        let label = window.label().to_owned();
        window.on_window_event(move |event| {
            if let WindowEvent::ScaleFactorChanged { scale_factor, .. } = event {
                spike.log(
                    "scale_factor_changed",
                    serde_json::json!({ "label": label, "scaleFactor": scale_factor }),
                );
                // tao repositions the window to the OS-suggested rect; put it back. This
                // callback may run inside a `SetWindowPos` issued while `windows` is locked, so
                // hop through the async runtime: from a worker thread `run_on_main_thread`
                // is queued instead of executed inline.
                let spike = Arc::clone(&spike);
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let app_for_task = app.clone();
                    if let Err(error) =
                        app.run_on_main_thread(move || spike.reconcile(&app_for_task))
                    {
                        tracing::warn!(%error, "run_on_main_thread failed");
                    }
                });
            }
        });
    }

    fn target_rect(&self, monitor: &MonitorInfo) -> Rect {
        if self.parked.load(Ordering::Relaxed) {
            layout::parked_rect(monitor)
        } else {
            layout::placed_rect(monitor)
        }
    }

    fn move_window(&self, window: &mut NotchWindow, rect: Rect) {
        if let Err(error) = self.windowing().move_async(window.hwnd, rect) {
            self.log(
                "move_error",
                serde_json::json!({ "label": window.label, "error": error.to_string() }),
            );
            return;
        }
        window.rect = rect;
        self.log(
            "moved",
            serde_json::json!({ "label": window.label, "rect": rect, "parked": self.parked.load(Ordering::Relaxed) }),
        );
        // Shapes are stored in CSS px relative to the client area; their screen rects follow.
        Self::refresh_shapes(window);
        if !window.css_shapes.is_empty() {
            self.log_shapes(window);
        }
    }

    /// Logs the current shapes; `physical` is in screen pixels, so scripts must read the
    /// latest event (it is re-emitted after every move).
    fn log_shapes(&self, window: &NotchWindow) {
        self.log(
            "shapes",
            serde_json::json!({
                "label": window.label,
                "css": window.css_shapes,
                "physical": window.hit_tester.shapes(),
                "windowRect": window.rect,
            }),
        );
    }

    fn refresh_shapes(window: &mut NotchWindow) {
        let physical: Vec<Rect> = window
            .css_shapes
            .iter()
            .map(|s| {
                layout::shape_to_physical(
                    &window.monitor,
                    window.rect,
                    [
                        f64::from(s.x),
                        f64::from(s.y),
                        f64::from(s.width),
                        f64::from(s.height),
                    ],
                )
            })
            .collect();
        window.hit_tester.set_shapes(physical);
    }

    /// Called by the UI after its first painted frame: records time-to-ready, verifies the
    /// window styles and moves the window into place. A webview can report ready before the
    /// spike has attached its window (config windows load while Tauri is still starting);
    /// those labels are remembered and applied when the window is attached.
    pub fn window_ready(&self, label: &str) {
        let mut windows = self.windows.lock();
        let Some(window) = windows.iter_mut().find(|w| w.label == label) else {
            self.log("ready_before_attach", serde_json::json!({ "label": label }));
            self.early_ready.lock().insert(label.to_owned());
            return;
        };
        self.mark_ready(window);
    }

    fn mark_ready(&self, window: &mut NotchWindow) {
        let first = !window.ready;
        window.ready = true;
        let before = self.describe_styles(window.hwnd);
        // tao removes the taskbar button with `ITaskbarList::DeleteTab` but leaves
        // `WS_EX_APPWINDOW` set and never sets `WS_EX_TOOLWINDOW`, which is what keeps a
        // window out of Alt+Tab; the shell owns that style (ADR-0002 amendment).
        let tool_window = match self.windowing().set_tool_window(window.hwnd) {
            Ok(style) => serde_json::json!(format!("{style:#010x}")),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        };
        let styles = self.describe_styles(window.hwnd);
        self.log(
            "ready",
            serde_json::json!({
                "label": window.label,
                "first": first,
                "stylesAtCreation": before,
                "toolWindowApplied": tool_window,
                "styles": styles,
            }),
        );
        let rect = self.target_rect(&window.monitor.clone());
        self.move_window(window, rect);
        if let Err(error) = self.windowing().assert_topmost(window.hwnd) {
            tracing::warn!(%error, "assert_topmost failed");
        }
        if self.capture_excluded.load(Ordering::Relaxed) {
            self.apply_capture_exclusion(window, true);
        }
    }

    fn describe_styles(&self, hwnd: WindowHandle) -> serde_json::Value {
        match self.windowing().extended_style(hwnd) {
            Ok(style) => serde_json::json!({
                "exStyle": format!("{style:#010x}"),
                "topmost": style & WS_EX_TOPMOST != 0,
                "toolWindow": style & WS_EX_TOOLWINDOW != 0,
                "appWindow": style & WS_EX_APPWINDOW != 0,
                "noActivate": style & WS_EX_NOACTIVATE != 0,
                "layered": style & WS_EX_LAYERED != 0,
                "transparent": style & WS_EX_TRANSPARENT != 0,
            }),
            Err(error) => serde_json::json!({ "error": error.to_string() }),
        }
    }

    /// Stores the UI's painted shapes (CSS px, client-relative) as physical screen rects.
    /// Shapes for a label that is not attached yet are kept and applied on attach.
    pub fn publish_shapes(&self, label: &str, shapes: &[ShapeRect]) {
        let mut windows = self.windows.lock();
        let Some(window) = windows.iter_mut().find(|w| w.label == label) else {
            self.log(
                "shapes_before_attach",
                serde_json::json!({ "label": label }),
            );
            self.early_shapes
                .lock()
                .insert(label.to_owned(), shapes.to_vec());
            return;
        };
        shapes.clone_into(&mut window.css_shapes);
        Self::refresh_shapes(window);
        self.log_shapes(window);
    }

    /// Asks one webview for a low (or normal) memory usage target and logs the outcome.
    pub fn set_memory_target(self: &Arc<Self>, app: &AppHandle, label: &str, low: bool) {
        let Some(window) = app.get_webview_window(label) else {
            return;
        };
        #[cfg(windows)]
        {
            use muna_platform::windows::webview::{MemoryUsageTarget, set_memory_usage_target};
            let spike = Arc::clone(self);
            let owned_label = label.to_owned();
            let target = if low {
                MemoryUsageTarget::Low
            } else {
                MemoryUsageTarget::Normal
            };
            let result = window.with_webview(move |webview| {
                let outcome = set_memory_usage_target(&webview.controller(), target);
                spike.log(
                    "memory_target",
                    serde_json::json!({
                        "label": owned_label,
                        "target": format!("{target:?}"),
                        "error": outcome.err().map(|e| e.to_string()),
                    }),
                );
            });
            if let Err(error) = result {
                tracing::warn!(%error, label, "with_webview failed");
            }
        }
        #[cfg(not(windows))]
        {
            let _ = (window, low);
        }
    }

    /// Records a morph measured by the UI (microseconds in, milliseconds in the log).
    pub fn record_morph(&self, label: &str, report: &MorphReport) {
        let duration_ms = f64::from(report.duration_us) / 1000.0;
        let fps = if duration_ms > 0.0 {
            f64::from(report.frames) * 1000.0 / duration_ms
        } else {
            0.0
        };
        self.log(
            "morph",
            serde_json::json!({
                "label": label,
                "expanded": report.expanded,
                "frames": report.frames,
                "durationMs": duration_ms,
                "maxFrameMs": f64::from(report.max_frame_us) / 1000.0,
                "droppedFrames": report.dropped_frames,
                "fps": fps,
            }),
        );
    }

    /// One cursor sample across every ready window; returns the poll rate for the next tick.
    fn poll_cursor(&self) -> PollRate {
        let cursor = match self.windowing().cursor_position() {
            Ok(cursor) => cursor,
            Err(error) => {
                tracing::warn!(%error, "cursor poll failed");
                return PollRate::Idle;
            }
        };
        let mut rate = PollRate::Idle;
        let mut toggles: Vec<(String, WindowHandle, bool)> = Vec::new();
        {
            let mut windows = self.windows.lock();
            for window in windows.iter_mut().filter(|w| w.ready) {
                let decision = window.hit_tester.observe(cursor, window.rect);
                if decision.rate == PollRate::Active {
                    rate = PollRate::Active;
                }
                if let Some(ignore) = decision.set_ignore {
                    toggles.push((window.label.clone(), window.hwnd, ignore));
                }
            }
        }
        // Applied outside the lock: `SetWindowLongPtr` on a window owned by the main thread is
        // a synchronous `SendMessage(WM_STYLECHANGING)`, and the main thread may be waiting for
        // `windows` (deadlock seen in the spike's first W7 run).
        //
        // Not tao's `set_ignore_cursor_events`: tao recomputes the whole ex-style from its own
        // flags on every change and would drop `WS_EX_TOOLWINDOW` again (docs/spikes/m0-window.md).
        for (label, hwnd, ignore) in toggles {
            let started = Instant::now();
            let result = self.windowing().set_click_through(hwnd, ignore);
            let apply_ms = started.elapsed().as_secs_f64() * 1000.0;
            if let Err(error) = &result {
                tracing::warn!(%error, "set_click_through failed");
            }
            self.log(
                "ignore_cursor",
                serde_json::json!({
                    "label": label,
                    "ignore": ignore,
                    "cursor": cursor,
                    "applyMs": apply_ms,
                    "error": result.err().map(|e| e.to_string()),
                }),
            );
        }
        rate
    }

    /// Parks or unparks every window (never hides it, docs/04 rule).
    pub fn set_parked(&self, parked: bool, reason: &str) {
        if self.parked.swap(parked, Ordering::Relaxed) == parked {
            return;
        }
        self.log(
            "park",
            serde_json::json!({ "parked": parked, "reason": reason }),
        );
        let mut windows = self.windows.lock();
        for window in windows.iter_mut().filter(|w| w.ready) {
            let rect = if parked {
                layout::parked_rect(&window.monitor)
            } else {
                layout::placed_rect(&window.monitor)
            };
            self.move_window(window, rect);
        }
    }

    fn toggle_parked(&self) {
        let parked = !self.parked.load(Ordering::Relaxed);
        self.set_parked(parked, "shortcut");
    }

    /// Emits `MorphRequested` to every notch window.
    pub fn request_morph(&self, app: &AppHandle, expanded: bool) {
        self.expanded.store(expanded, Ordering::Relaxed);
        self.log(
            "morph_requested",
            serde_json::json!({ "expanded": expanded }),
        );
        if let Err(error) = (MorphRequested { expanded }).emit(app) {
            tracing::warn!(%error, "emit MorphRequested failed");
        }
    }

    fn toggle_morph(&self, app: &AppHandle) {
        let expanded = !self.expanded.load(Ordering::Relaxed);
        self.request_morph(app, expanded);
    }

    /// Toggles `WDA_EXCLUDEFROMCAPTURE` on every window.
    pub fn set_capture_exclusion(&self, excluded: bool) {
        self.capture_excluded.store(excluded, Ordering::Relaxed);
        let mut windows = self.windows.lock();
        for window in windows.iter_mut().filter(|w| w.ready) {
            self.apply_capture_exclusion(window, excluded);
        }
    }

    fn apply_capture_exclusion(&self, window: &NotchWindow, excluded: bool) {
        let result = self
            .windowing()
            .set_capture_exclusion(window.hwnd, excluded);
        self.log(
            "capture_exclusion",
            serde_json::json!({
                "label": window.label,
                "excluded": excluded,
                "error": result.err().map(|e| e.to_string()),
            }),
        );
    }

    fn toggle_capture_exclusion(&self) {
        let excluded = !self.capture_excluded.load(Ordering::Relaxed);
        self.set_capture_exclusion(excluded);
    }

    fn assert_all_topmost(&self, foreground: &muna_platform::ForegroundWindow, phase: &str) {
        let windows = self.windows.lock();
        for window in windows.iter().filter(|w| w.ready) {
            if let Err(error) = self.windowing().assert_topmost(window.hwnd) {
                tracing::warn!(%error, "assert_topmost failed");
            }
        }
        self.log(
            "foreground",
            serde_json::json!({
                "phase": phase,
                "process": foreground.process_name,
                "fullscreen": foreground.is_fullscreen,
                "bounds": foreground.bounds,
                "reasserted": windows.iter().filter(|w| w.ready).count(),
            }),
        );
    }

    fn all_ready(&self) -> bool {
        let windows = self.windows.lock();
        !windows.is_empty() && windows.iter().all(|w| w.ready)
    }

    /// Verifies hit-testing from the outside: which top-level window is under each published
    /// shape's centre and under a transparent point of the window.
    fn probe_hit_test(&self) {
        let windows = self.windows.lock();
        for window in windows.iter().filter(|w| w.ready) {
            let shape_hits: Vec<serde_json::Value> = window
                .hit_tester
                .shapes()
                .iter()
                .map(|shape| {
                    let (cx, cy) = centre(*shape);
                    let hit = self.windowing().window_at(cx, cy).unwrap_or(0);
                    serde_json::json!({ "point": [cx, cy], "hwnd": hit, "isNotch": hit == window.hwnd })
                })
                .collect();
            let (tx, ty) = (
                window.rect.x + 10,
                window.rect.y + i32::try_from(window.rect.height).unwrap_or(0) - 10,
            );
            let transparent_hit = self.windowing().window_at(tx, ty).unwrap_or(0);
            self.log(
                "hit_probe",
                serde_json::json!({
                    "label": window.label,
                    "ignoring": window.hit_tester.is_ignoring(),
                    "styles": self.describe_styles(window.hwnd),
                    "shapes": shape_hits,
                    "transparentPoint": [tx, ty],
                    "transparentHwnd": transparent_hit,
                    "transparentIsNotch": transparent_hit == window.hwnd,
                }),
            );
        }
    }
}

fn centre(rect: Rect) -> (i32, i32) {
    (
        rect.x + i32::try_from(rect.width / 2).unwrap_or(0),
        rect.y + i32::try_from(rect.height / 2).unwrap_or(0),
    )
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

fn open_log(path: &Path) -> Option<File> {
    if let Some(parent) = path.parent()
        && let Err(error) = std::fs::create_dir_all(parent)
    {
        tracing::warn!(%error, "spike log directory unavailable");
        return None;
    }
    match OpenOptions::new().create(true).append(true).open(path) {
        Ok(file) => Some(file),
        Err(error) => {
            tracing::warn!(%error, "spike log unavailable");
            None
        }
    }
}

/// Wires the spike into a running app: windows, shortcuts, pollers and platform events.
/// Call from `setup` (main thread).
pub fn start(app: &AppHandle, spike: Arc<Spike>) {
    spike.log(
        "start",
        serde_json::json!({
            "platform": spike.platform.name(),
            "cycles": env_count("MUNA_SPIKE_CYCLES"),
            "morphs": env_count("MUNA_SPIKE_MORPHS"),
            "excludeCapture": env_count("MUNA_SPIKE_EXCLUDE_CAPTURE") == 1,
        }),
    );
    if env_count("MUNA_SPIKE_EXCLUDE_CAPTURE") == 1 {
        spike.capture_excluded.store(true, Ordering::Relaxed);
    }

    spike.reconcile(app);
    register_shortcuts(app, &spike);
    spawn_cursor_poll(Arc::clone(&spike));
    spawn_quiet_poll(Arc::clone(&spike));
    spawn_event_bridge(app, Arc::clone(&spike));
    spawn_memory_trim(app, Arc::clone(&spike));
    spawn_scripts(app, spike);
}

/// `MUNA_SPIKE_MEMORY_LOW=<seconds>`: once every window is ready and that many seconds have
/// passed, ask `WebView2` for `MemoryUsageTargetLevel::Low` (W5 mitigation A/B).
fn spawn_memory_trim(app: &AppHandle, spike: Arc<Spike>) {
    let after_secs = env_count("MUNA_SPIKE_MEMORY_LOW");
    if after_secs == 0 {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while !spike.all_ready() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_secs(u64::from(after_secs))).await;
        for label in window_labels(&spike) {
            spike.set_memory_target(&app, &label, true);
        }
    });
}

/// What a spike shortcut does when pressed.
type ShortcutAction = fn(&Spike, &AppHandle);

fn register_shortcuts(app: &AppHandle, spike: &Arc<Spike>) {
    let bindings: [(&str, ShortcutAction); 3] = [
        ("ctrl+alt+m", |spike, app| spike.toggle_morph(app)),
        ("ctrl+alt+p", |spike, _| spike.toggle_parked()),
        ("ctrl+alt+c", |spike, _| spike.toggle_capture_exclusion()),
    ];
    for (keys, action) in bindings {
        let spike = Arc::clone(spike);
        let result = app
            .global_shortcut()
            .on_shortcut(keys, move |app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    action(&spike, app);
                }
            });
        if let Err(error) = result {
            tracing::warn!(%error, keys, "global shortcut registration failed");
        }
    }
}

fn spawn_cursor_poll(spike: Arc<Spike>) {
    // A plain OS thread, not a tokio task: tokio's timer parks on the 15.6 ms Windows tick
    // (measured 31 ms for a 16.7 ms sleep), while `std::thread::sleep` uses a high-resolution
    // waitable timer on Windows 10 1803+ without raising the process timer resolution.
    let spawned = std::thread::Builder::new()
        .name("muna-cursor-poll".into())
        .spawn(move || {
            let mut stats = PollStats::default();
            loop {
                let started = Instant::now();
                let rate = spike.poll_cursor();
                if let Some(report) = stats.record(rate, started) {
                    spike.log("poll_stats", report);
                }
                std::thread::sleep(rate.interval());
            }
        });
    if let Err(error) = spawned {
        tracing::error!(%error, "cursor poll thread failed to start");
    }
}

/// Aggregates cursor-poll cadence per rate (real sampling period versus nominal) and reports
/// every few seconds or on a rate change.
#[derive(Default)]
struct PollStats {
    rate: Option<PollRate>,
    last: Option<Instant>,
    window_started: Option<Instant>,
    samples: u32,
    total: Duration,
    max: Duration,
}

impl PollStats {
    const REPORT_EVERY: Duration = Duration::from_secs(5);

    fn record(&mut self, rate: PollRate, now: Instant) -> Option<serde_json::Value> {
        let mut report = None;
        if self.rate.is_some_and(|previous| previous != rate) {
            report = self.flush();
        }
        if let Some(last) = self.last {
            let interval = now.duration_since(last);
            self.samples += 1;
            self.total += interval;
            self.max = self.max.max(interval);
        }
        self.rate = Some(rate);
        self.last = Some(now);
        let started = *self.window_started.get_or_insert(now);
        if now.duration_since(started) >= Self::REPORT_EVERY {
            report = self.flush().or(report);
        }
        report
    }

    fn flush(&mut self) -> Option<serde_json::Value> {
        let rate = self.rate?;
        let report = (self.samples > 0).then(|| {
            serde_json::json!({
                "rate": format!("{rate:?}"),
                "nominalMs": rate.interval().as_secs_f64() * 1000.0,
                "samples": self.samples,
                "meanMs": self.total.as_secs_f64() * 1000.0 / f64::from(self.samples),
                "maxMs": self.max.as_secs_f64() * 1000.0,
            })
        });
        self.samples = 0;
        self.total = Duration::ZERO;
        self.max = Duration::ZERO;
        self.window_started = None;
        self.last = None;
        report
    }
}

fn spawn_quiet_poll(spike: Arc<Spike>) {
    tauri::async_runtime::spawn(async move {
        let mut last: Option<(muna_platform::UserNotificationState, Option<bool>)> = None;
        // Only undo parks this poller caused; shortcut/script parks are left alone.
        let mut parked_by_quiet = false;
        loop {
            tokio::time::sleep(QUIET_POLL).await;
            let state = match spike.windowing().user_notification_state() {
                Ok(state) => state,
                Err(error) => {
                    tracing::warn!(%error, "quiet state poll failed");
                    continue;
                }
            };
            // `QUNS_BUSY` is only a hint (W6): confirm against the foreground window, sampled
            // fresh because a window going fullscreen does not raise a foreground event.
            let foreground_fullscreen = if state.requires_fullscreen_confirmation() {
                match spike.platform.foreground().current() {
                    Ok(foreground) => Some(foreground.is_some_and(|w| w.is_fullscreen)),
                    Err(error) => {
                        tracing::warn!(%error, "foreground snapshot failed");
                        None
                    }
                }
            } else {
                None
            };
            let park = state.should_park(foreground_fullscreen);
            if last != Some((state, foreground_fullscreen)) {
                spike.log(
                    "quiet_state",
                    serde_json::json!({
                        "state": state,
                        "foregroundFullscreen": foreground_fullscreen,
                        "park": park,
                    }),
                );
                last = Some((state, foreground_fullscreen));
            }
            if park {
                if !spike.parked.load(Ordering::Relaxed) {
                    spike.set_parked(true, "quiet_state");
                    parked_by_quiet = true;
                }
            } else if parked_by_quiet {
                spike.set_parked(false, "quiet_state");
                parked_by_quiet = false;
            }
        }
    });
}

fn spawn_event_bridge(app: &AppHandle, spike: Arc<Spike>) {
    let app = app.clone();
    let mut events = spike.platform.subscribe();
    tauri::async_runtime::spawn(async move {
        loop {
            match events.recv().await {
                Ok(PlatformEvent::ForegroundChanged(foreground)) => {
                    // Three times: the system raises the newly activated window *after*
                    // delivering EVENT_SYSTEM_FOREGROUND, so an immediate re-assert alone always
                    // loses the race against a topmost foreground window (W12,
                    // docs/spikes/m0-window.md). The short settle catches the common case, the
                    // long one slow activations (UAC band, fullscreen transitions).
                    spike.assert_all_topmost(&foreground, "immediate");
                    let spike = Arc::clone(&spike);
                    tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(TOPMOST_SETTLE_SHORT).await;
                        spike.assert_all_topmost(&foreground, "settled");
                        tokio::time::sleep(
                            TOPMOST_SETTLE_LONG.saturating_sub(TOPMOST_SETTLE_SHORT),
                        )
                        .await;
                        spike.assert_all_topmost(&foreground, "late");
                    });
                }
                Ok(PlatformEvent::MonitorsChanged(monitors)) => {
                    spike.log(
                        "display_change",
                        serde_json::json!({ "count": monitors.len() }),
                    );
                    let spike = Arc::clone(&spike);
                    let app_for_task = app.clone();
                    if let Err(error) =
                        app.run_on_main_thread(move || spike.reconcile(&app_for_task))
                    {
                        tracing::warn!(%error, "run_on_main_thread failed");
                    }
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

/// Scripted runs driven by environment variables, for the measurement scripts.
fn spawn_scripts(app: &AppHandle, spike: Arc<Spike>) {
    let cycles = env_count("MUNA_SPIKE_CYCLES");
    let morphs = env_count("MUNA_SPIKE_MORPHS");
    if cycles == 0 && morphs == 0 {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while !spike.all_ready() {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        spike.probe_hit_test();

        if cycles > 0 {
            spike.log("cycles_start", serde_json::json!({ "cycles": cycles }));
            for _ in 0..cycles {
                spike.set_parked(true, "script");
                tokio::time::sleep(CYCLE_HALF_PERIOD).await;
                spike.set_parked(false, "script");
                tokio::time::sleep(CYCLE_HALF_PERIOD).await;
            }
            spike.log("cycles_done", serde_json::json!({ "cycles": cycles }));
        }

        if morphs > 0 {
            spike.log("morphs_start", serde_json::json!({ "morphs": morphs }));
            for i in 0..morphs {
                spike.request_morph(&app, i % 2 == 0);
                tokio::time::sleep(MORPH_PERIOD).await;
            }
            spike.request_morph(&app, false);
            tokio::time::sleep(MORPH_PERIOD).await;
            spike.log("morphs_done", serde_json::json!({ "morphs": morphs }));
        }
        spike.probe_hit_test();
        spike.log("script_done", serde_json::json!({}));
    });
}

/// Windows the spike currently manages, for diagnostics.
#[must_use]
pub fn window_labels(spike: &Spike) -> Vec<String> {
    spike
        .windows
        .lock()
        .iter()
        .map(|w| w.label.clone())
        .collect()
}

/// Mapping label → monitor id, for diagnostics.
#[must_use]
pub fn window_monitors(spike: &Spike) -> HashMap<String, String> {
    spike
        .windows
        .lock()
        .iter()
        .map(|w| (w.label.clone(), w.monitor.id.clone()))
        .collect()
}
