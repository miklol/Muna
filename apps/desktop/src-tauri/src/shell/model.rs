//! The notch shell's state, independent of Tauri: which monitor has which window, where each
//! window is (placed or parked), what the UI painted, and what the yield rules currently say.
//! Every OS effect goes through `muna_platform` traits so the whole model runs against
//! [`muna_platform::FakePlatform`] in `tests/shell_model.rs`; `manager.rs` adds the Tauri glue
//! (window creation, event emission, timers).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::time::Instant;

use muna_core::{MonitorLayout, NotchShape, PlacementMode, ShellSettings};
use muna_platform::{
    ForegroundWindow, MonitorInfo, Platform, Rect, UserNotificationState, WindowHandle,
};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::hit_test::{HitTester, PollRate};
use super::layout;
use super::yield_rules::{ParkDebounce, YieldInputs, YieldState, decide};
use crate::ipc::ShapeRect;

/// Label of the window declared in `tauri.conf.json`; secondary monitors get `notch-<n>`.
pub const PRIMARY_LABEL: &str = "notch";

/// What the UI needs to render one notch window (`ShellLayoutChanged`, `get_shell_layout`).
/// CSS px throughout; the window itself is always [`layout::WINDOW_LOGICAL`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShellLayout {
    pub label: String,
    pub monitor_id: String,
    pub is_primary: bool,
    pub enabled: bool,
    pub mode: PlacementMode,
    pub shape: NotchShape,
    /// Strip height preset in CSS px (32 / 26 / 38).
    pub strip_height: u32,
    /// CSS px between the window's top edge and the strip (0 for Notch, 8 for Island).
    pub strip_top_offset: u32,
    /// `min(1000, monitorWidth − 80)`.
    pub panel_max_width: u32,
    /// Monitor scale as a whole percentage (100, 125, 150, …).
    pub scale_percent: u32,
    pub yield_state: YieldState,
}

/// Side effects the Tauri glue must perform after a model call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Emit `ShellLayoutChanged` to the window.
    LayoutChanged(ShellLayout),
    /// Emit `ShellYieldChanged` to the window.
    YieldChanged { label: String, state: YieldState },
    /// Call [`ShellModel::evaluate`] again at this instant (a park/unpark is debouncing).
    RecheckAt(Instant),
}

/// Windows to create or destroy after [`ShellModel::plan_reconcile`]; both happen outside the
/// model's lock because creating a webview pumps messages (docs/spikes/m0-window.md).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ReconcilePlan {
    pub create: Vec<(String, MonitorInfo)>,
    pub destroy: Vec<String>,
}

/// One notch window and everything the shell knows about it.
#[derive(Debug)]
pub struct NotchState {
    pub label: String,
    pub hwnd: WindowHandle,
    pub monitor: MonitorInfo,
    pub layout: MonitorLayout,
    /// Where the window is right now (placed or parked).
    pub rect: Rect,
    pub ready: bool,
    /// Last shapes published by the UI, CSS px relative to the client area.
    pub css_shapes: Vec<ShapeRect>,
    pub hit_tester: HitTester,
    /// Last state emitted to the UI.
    pub yield_state: YieldState,
    pub debounce: ParkDebounce,
    /// `true` while the UI asked to take focus (a text field is focused while Pinned).
    pub focusable: bool,
    /// `true` while an OLE file drag is over this window (docs/modules/drop-actions.md).
    pub dragging: bool,
    /// Physical height of the live `AppBar` reservation, when in Reserved mode.
    pub reserved: Option<u32>,
}

impl NotchState {
    fn placed_rect(&self) -> Rect {
        layout::placed_rect_for(&self.monitor, &self.layout)
    }

    fn parked_rect(&self) -> Rect {
        layout::parked_rect_for(&self.monitor, &self.layout)
    }

    /// The strip's screen rect for the yield rules: the first published shape (the UI
    /// publishes the strip first) at the window's *placed* position, else the default strip.
    fn strip_rect(&self) -> Rect {
        let placed = self.placed_rect();
        self.css_shapes.first().map_or_else(
            || layout::default_strip_rect(&self.monitor, &self.layout, placed),
            |shape| {
                layout::shape_to_physical(
                    &self.monitor,
                    placed,
                    [
                        f64::from(shape.x),
                        f64::from(shape.y),
                        f64::from(shape.width),
                        f64::from(shape.height),
                    ],
                )
            },
        )
    }

    fn refresh_shapes(&mut self) {
        // The UI keeps publishing the strip at rest while it peeks (the yield reference above
        // must not follow the slide, or peek would flap), but it paints only the sliver at the
        // top edge: the hit tester follows the sliver so the caption under the strip's rest
        // position stays clickable.
        let peek_rise = if self.yield_state == YieldState::Peek {
            (layout::strip_top_offset(self.layout.shape) + self.layout.strip_height.css_px())
                .saturating_sub(layout::PEEK_HEIGHT_PX)
        } else {
            0
        };
        let physical: Vec<Rect> = self
            .css_shapes
            .iter()
            .enumerate()
            .map(|(index, s)| {
                let rise = if index == 0 { peek_rise } else { 0 };
                layout::shape_to_physical(
                    &self.monitor,
                    self.rect,
                    [
                        f64::from(s.x),
                        f64::from(s.y) - f64::from(rise),
                        f64::from(s.width),
                        f64::from(s.height),
                    ],
                )
            })
            .collect();
        self.hit_tester.set_shapes(physical);
    }

    fn shell_layout(&self) -> ShellLayout {
        ShellLayout {
            label: self.label.clone(),
            monitor_id: self.monitor.id.clone(),
            is_primary: self.monitor.is_primary,
            enabled: self.layout.enabled,
            mode: self.layout.mode,
            shape: self.layout.shape,
            strip_height: self.layout.strip_height.css_px(),
            strip_top_offset: layout::strip_top_offset(self.layout.shape),
            panel_max_width: layout::panel_max_width(&self.monitor),
            scale_percent: layout::scale_percent(&self.monitor),
            yield_state: self.yield_state,
        }
    }
}

/// The shell model. Not thread-safe by itself; the manager wraps it in a mutex and never
/// holds that lock across window creation or `SetWindowLongPtr` (see `poll_cursor`).
///
/// The flags are independent observations from different Win32 sources, not a state machine
/// (see [`YieldInputs`]).
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug)]
pub struct ShellModel {
    settings: ShellSettings,
    windows: Vec<NotchState>,
    monitors: Vec<MonitorInfo>,
    foreground: Option<ForegroundWindow>,
    quiet: UserNotificationState,
    moving: bool,
    /// The current window drag is a Window snap candidate (docs/modules/window-snap.md): the
    /// strip holds still for the zones and the cursor poll reports where the drag is.
    snapping: bool,
    locked: bool,
    paused: BTreeSet<String>,
    /// Muna's other windows (settings) so focusing them never counts as a foreground change.
    own_handles: Vec<WindowHandle>,
    /// Labels whose webview reported ready before the window was attached.
    early_ready: HashSet<String>,
    /// Shapes published before the window was attached (the UI publishes once at ready).
    early_shapes: HashMap<String, Vec<ShapeRect>>,
    /// Button level at the previous cursor sample, for the press-outside rising edge.
    pointer_button_was_down: bool,
    next_label: u32,
}

impl ShellModel {
    #[must_use]
    pub fn new(settings: ShellSettings) -> Self {
        Self {
            settings,
            windows: Vec::new(),
            monitors: Vec::new(),
            foreground: None,
            quiet: UserNotificationState::AcceptsNotifications,
            moving: false,
            snapping: false,
            locked: false,
            paused: BTreeSet::new(),
            own_handles: Vec::new(),
            early_ready: HashSet::new(),
            early_shapes: HashMap::new(),
            pointer_button_was_down: false,
            next_label: 1,
        }
    }

    #[must_use]
    pub fn settings(&self) -> &ShellSettings {
        &self.settings
    }

    #[must_use]
    pub fn windows(&self) -> &[NotchState] {
        &self.windows
    }

    #[must_use]
    pub fn window(&self, label: &str) -> Option<&NotchState> {
        self.windows.iter().find(|w| w.label == label)
    }

    fn window_mut(&mut self, label: &str) -> Option<&mut NotchState> {
        self.windows.iter_mut().find(|w| w.label == label)
    }

    #[must_use]
    pub fn labels(&self) -> Vec<String> {
        self.windows.iter().map(|w| w.label.clone()).collect()
    }

    #[must_use]
    pub fn monitors(&self) -> &[MonitorInfo] {
        &self.monitors
    }

    /// Monitors the user paused from the tray.
    #[must_use]
    pub fn paused_monitors(&self) -> &BTreeSet<String> {
        &self.paused
    }

    #[must_use]
    pub fn is_own_window(&self, handle: WindowHandle) -> bool {
        handle != 0
            && (self.own_handles.contains(&handle) || self.windows.iter().any(|w| w.hwnd == handle))
    }

    pub fn set_own_handles(&mut self, handles: Vec<WindowHandle>) {
        self.own_handles = handles;
    }

    /// Layout for the UI; `None` until the window is attached.
    #[must_use]
    pub fn shell_layout(&self, label: &str) -> Option<ShellLayout> {
        self.window(label).map(NotchState::shell_layout)
    }

    /// The label of the notch on the monitor under `cursor`, else the primary one.
    #[must_use]
    pub fn label_at(&self, cursor: (i32, i32)) -> Option<String> {
        self.windows
            .iter()
            .find(|w| w.monitor.bounds.contains(cursor.0, cursor.1))
            .or_else(|| self.windows.iter().find(|w| w.monitor.is_primary))
            .or_else(|| self.windows.first())
            .map(|w| w.label.clone())
    }

    /// The label of the notch whose painted shape the cursor is over, per the last cursor
    /// sample; `None` while every window passes the pointer through.
    #[must_use]
    pub fn hovered_label(&self) -> Option<String> {
        self.windows
            .iter()
            .find(|w| w.ready && !w.hit_tester.is_ignoring())
            .map(|w| w.label.clone())
    }

    // --- reconcile ------------------------------------------------------------------------

    /// Phase 1 of a reconcile: records the monitor list, refreshes known windows (moving ready
    /// ones to their new place) and returns which windows to create or destroy. Every monitor
    /// gets a window; disabled monitors keep theirs parked (a destroyed primary window could
    /// not be re-created from the config label).
    pub fn plan_reconcile(
        &mut self,
        platform: &dyn Platform,
        monitors: Vec<MonitorInfo>,
        now: Instant,
    ) -> (ReconcilePlan, Vec<Effect>) {
        self.monitors = monitors;
        let mut plan = ReconcilePlan::default();
        let mut assigned: Vec<String> = Vec::new();
        let mut moved: Vec<String> = Vec::new();

        for monitor in self.monitors.clone() {
            let label = if monitor.is_primary {
                PRIMARY_LABEL.to_owned()
            } else if let Some(existing) = self
                .windows
                .iter()
                .find(|w| w.label != PRIMARY_LABEL && w.monitor.id == monitor.id)
            {
                existing.label.clone()
            } else {
                let label = format!("{PRIMARY_LABEL}-{}", self.next_label);
                self.next_label += 1;
                label
            };
            assigned.push(label.clone());

            let layout = self.settings.layout_for(&monitor.id).clone();
            if let Some(existing) = self.window_mut(&label) {
                let changed = existing.monitor != monitor || existing.layout != layout;
                existing.monitor = monitor;
                existing.layout = layout;
                if changed && existing.ready {
                    moved.push(label);
                }
            } else {
                plan.create.push((label, monitor));
            }
        }

        // The config window survives its monitor: it is re-assigned when a primary appears.
        let mut kept = Vec::with_capacity(self.windows.len());
        for window in self.windows.drain(..) {
            if assigned.contains(&window.label) || window.label == PRIMARY_LABEL {
                kept.push(window);
                continue;
            }
            if window.reserved.is_some()
                && let Err(error) = platform.app_bar().release(window.hwnd)
            {
                tracing::warn!(%error, label = window.label, "app bar release failed");
            }
            plan.destroy.push(window.label);
        }
        self.windows = kept;

        let mut effects = Vec::new();
        for label in moved {
            self.place(platform, &label);
            if let Some(layout) = self.shell_layout(&label) {
                effects.push(Effect::LayoutChanged(layout));
            }
        }
        effects.extend(self.evaluate(platform, now));
        (plan, effects)
    }

    /// Registers a created (or adopted) window and replays anything the UI reported before
    /// the window was attached.
    pub fn attach(
        &mut self,
        platform: &dyn Platform,
        label: &str,
        hwnd: WindowHandle,
        monitor: MonitorInfo,
        now: Instant,
    ) -> Vec<Effect> {
        if self.window(label).is_some() {
            return Vec::new();
        }
        let layout = self.settings.layout_for(&monitor.id).clone();
        let early_shapes = self.early_shapes.remove(label);
        let early_ready = self.early_ready.remove(label);
        self.windows.push(NotchState {
            label: label.to_owned(),
            hwnd,
            monitor,
            layout,
            rect: Rect::default(),
            ready: false,
            css_shapes: Vec::new(),
            hit_tester: HitTester::new(),
            yield_state: YieldState::None,
            debounce: ParkDebounce::new(),
            focusable: false,
            dragging: false,
            reserved: None,
        });
        let mut effects = Vec::new();
        if let Some(shapes) = early_shapes {
            effects.extend(self.publish_shapes(platform, label, &shapes, now));
        }
        if early_ready {
            effects.extend(self.window_ready(platform, label, now));
        } else if let Some(layout) = self.shell_layout(label) {
            effects.push(Effect::LayoutChanged(layout));
        }
        effects
    }

    // --- UI reports -----------------------------------------------------------------------

    /// The UI painted its first frame: fix the styles tao got wrong, place the window and
    /// tell the UI its layout and yield state.
    pub fn window_ready(
        &mut self,
        platform: &dyn Platform,
        label: &str,
        now: Instant,
    ) -> Vec<Effect> {
        let Some(window) = self.window_mut(label) else {
            self.early_ready.insert(label.to_owned());
            return Vec::new();
        };
        let first = !window.ready;
        window.ready = true;
        let hwnd = window.hwnd;
        if first {
            // tao removes the taskbar button but leaves `WS_EX_APPWINDOW` set and never sets
            // `WS_EX_TOOLWINDOW`, which is what keeps a window out of Alt+Tab (ADR-0002).
            if let Err(error) = platform.windowing().set_tool_window(hwnd) {
                tracing::warn!(%error, label, "set_tool_window failed");
            }
            if let Err(error) = platform
                .windowing()
                .set_capture_exclusion(hwnd, self.settings.hide_from_captures)
            {
                tracing::warn!(%error, label, "set_capture_exclusion failed");
            }
        }
        self.place(platform, label);
        if let Err(error) = platform.windowing().assert_topmost(hwnd) {
            tracing::warn!(%error, label, "assert_topmost failed");
        }
        let mut effects = self.evaluate(platform, now);
        if let Some(layout) = self.shell_layout(label) {
            effects.insert(0, Effect::LayoutChanged(layout));
        }
        if let Some(window) = self.window(label)
            && !effects
                .iter()
                .any(|e| matches!(e, Effect::YieldChanged { label: l, .. } if l == label))
        {
            effects.push(Effect::YieldChanged {
                label: label.to_owned(),
                state: window.yield_state,
            });
        }
        effects
    }

    /// Stores the UI's painted shapes (CSS px, client-relative); the first one is the strip.
    pub fn publish_shapes(
        &mut self,
        platform: &dyn Platform,
        label: &str,
        shapes: &[ShapeRect],
        now: Instant,
    ) -> Vec<Effect> {
        let Some(window) = self.window_mut(label) else {
            self.early_shapes.insert(label.to_owned(), shapes.to_vec());
            return Vec::new();
        };
        shapes.clone_into(&mut window.css_shapes);
        window.refresh_shapes();
        // The strip rect feeds the caption-overlap rule.
        self.evaluate(platform, now)
    }

    /// The UI wants (or no longer wants) keyboard focus: toggles `WS_EX_NOACTIVATE`.
    pub fn set_focusable(&mut self, platform: &dyn Platform, label: &str, focusable: bool) {
        let Some(window) = self.window_mut(label) else {
            return;
        };
        if window.focusable == focusable {
            return;
        }
        window.focusable = focusable;
        if let Err(error) = platform
            .windowing()
            .set_no_activate(window.hwnd, !focusable)
        {
            tracing::warn!(%error, label, "set_no_activate failed");
        }
    }

    // --- platform inputs ------------------------------------------------------------------

    pub fn set_foreground(
        &mut self,
        platform: &dyn Platform,
        foreground: Option<ForegroundWindow>,
        now: Instant,
    ) -> Vec<Effect> {
        if foreground
            .as_ref()
            .is_some_and(|window| self.is_own_window(window.handle))
        {
            return Vec::new();
        }
        if self.foreground == foreground {
            return Vec::new();
        }
        self.foreground = foreground;
        self.evaluate(platform, now)
    }

    pub fn set_quiet(
        &mut self,
        platform: &dyn Platform,
        quiet: UserNotificationState,
        now: Instant,
    ) -> Vec<Effect> {
        if self.quiet == quiet {
            return Vec::new();
        }
        self.quiet = quiet;
        self.evaluate(platform, now)
    }

    pub fn set_moving(
        &mut self,
        platform: &dyn Platform,
        moving: bool,
        now: Instant,
    ) -> Vec<Effect> {
        if self.moving == moving {
            return Vec::new();
        }
        self.moving = moving;
        self.evaluate(platform, now)
    }

    /// The Window snap module is (`true`) or is no longer (`false`) tracking the current
    /// window drag: while it is, no window peeks for the drag and [`Self::poll_cursor`] samples
    /// which notch window the cursor is over.
    pub fn set_snapping(
        &mut self,
        platform: &dyn Platform,
        snapping: bool,
        now: Instant,
    ) -> Vec<Effect> {
        if self.snapping == snapping {
            return Vec::new();
        }
        self.snapping = snapping;
        self.evaluate(platform, now)
    }

    #[must_use]
    pub fn is_snapping(&self) -> bool {
        self.snapping
    }

    pub fn set_locked(
        &mut self,
        platform: &dyn Platform,
        locked: bool,
        now: Instant,
    ) -> Vec<Effect> {
        if self.locked == locked {
            return Vec::new();
        }
        self.locked = locked;
        self.evaluate(platform, now)
    }

    /// An OLE file drag entered (`true`) or left (`false`) one notch window
    /// (docs/modules/drop-actions.md): while it is over the window the strip stays put so the
    /// drop tiles can be hit, whatever a caption or a window drag would otherwise ask.
    pub fn set_dragging(
        &mut self,
        platform: &dyn Platform,
        label: &str,
        dragging: bool,
        now: Instant,
    ) -> Vec<Effect> {
        let Some(window) = self.window_mut(label) else {
            return Vec::new();
        };
        if window.dragging == dragging {
            return Vec::new();
        }
        window.dragging = dragging;
        self.evaluate(platform, now)
    }

    /// Pauses or resumes the notch on one monitor (tray "Pause on this display").
    pub fn set_paused(
        &mut self,
        platform: &dyn Platform,
        monitor_id: &str,
        paused: bool,
        now: Instant,
    ) -> Vec<Effect> {
        let changed = if paused {
            self.paused.insert(monitor_id.to_owned())
        } else {
            self.paused.remove(monitor_id)
        };
        if !changed {
            return Vec::new();
        }
        self.evaluate(platform, now)
    }

    /// New shell settings: re-places every window, updates capture exclusion and `AppBars`.
    pub fn apply_settings(
        &mut self,
        platform: &dyn Platform,
        settings: ShellSettings,
        now: Instant,
    ) -> Vec<Effect> {
        if self.settings == settings {
            return Vec::new();
        }
        let captures_changed = self.settings.hide_from_captures != settings.hide_from_captures;
        self.settings = settings;
        let hide_from_captures = self.settings.hide_from_captures;
        let mut effects = Vec::new();
        for label in self.labels() {
            let Some(monitor_id) = self.window(&label).map(|w| w.monitor.id.clone()) else {
                continue;
            };
            let layout = self.settings.layout_for(&monitor_id).clone();
            let Some(window) = self.window_mut(&label) else {
                continue;
            };
            let layout_changed = window.layout != layout;
            window.layout = layout;
            let (ready, hwnd) = (window.ready, window.hwnd);
            if !ready {
                continue;
            }
            if captures_changed
                && let Err(error) = platform
                    .windowing()
                    .set_capture_exclusion(hwnd, hide_from_captures)
            {
                tracing::warn!(%error, label, "set_capture_exclusion failed");
            }
            if layout_changed {
                self.place(platform, &label);
                if let Some(layout) = self.shell_layout(&label) {
                    effects.push(Effect::LayoutChanged(layout));
                }
            }
        }
        effects.extend(self.evaluate(platform, now));
        effects
    }

    // --- evaluation -----------------------------------------------------------------------

    /// Runs the yield rules for every ready window, parks/unparks (debounced), maintains the
    /// `AppBar` reservations and reports what changed.
    pub fn evaluate(&mut self, platform: &dyn Platform, now: Instant) -> Vec<Effect> {
        let mut effects = Vec::new();
        for index in 0..self.windows.len() {
            let Some(window) = self.windows.get(index) else {
                continue;
            };
            if !window.ready {
                continue;
            }
            let label = window.label.clone();
            let desired = if window.layout.enabled {
                decide(&YieldInputs {
                    mode: window.layout.mode,
                    monitor: &window.monitor,
                    monitors: &self.monitors,
                    strip: window.strip_rect(),
                    foreground: self.foreground.as_ref(),
                    quiet: self.quiet,
                    moving: self.moving,
                    snapping: self.snapping,
                    dragging: window.dragging,
                    locked: self.locked,
                    paused: self.paused.contains(&window.monitor.id),
                })
            } else {
                YieldState::Parked
            };
            let Some(window) = self.windows.get_mut(index) else {
                continue;
            };
            let was_parked = window.debounce.is_parked();
            let decision = window.debounce.observe(desired, now);
            if let Some(at) = decision.recheck_at {
                effects.push(Effect::RecheckAt(at));
            }
            if window.debounce.is_parked() != was_parked {
                self.place(platform, &label);
            }
            self.sync_app_bar(platform, &label);
            let Some(window) = self.windows.get_mut(index) else {
                continue;
            };
            if window.yield_state != decision.effective {
                window.yield_state = decision.effective;
                window.refresh_shapes();
                effects.push(Effect::YieldChanged {
                    label,
                    state: decision.effective,
                });
            }
        }
        effects
    }

    /// Moves a window to its placed or parked rect and refreshes its hit-test shapes.
    fn place(&mut self, platform: &dyn Platform, label: &str) {
        let Some(window) = self.window_mut(label) else {
            return;
        };
        let rect = if window.debounce.is_parked() {
            window.parked_rect()
        } else {
            window.placed_rect()
        };
        if let Err(error) = platform.windowing().move_async(window.hwnd, rect) {
            tracing::warn!(%error, label, "move_async failed");
            return;
        }
        window.rect = rect;
        window.refresh_shapes();
    }

    /// Reserved mode keeps an `AppBar` of the strip's height while the window is placed and the
    /// display is neither paused nor disabled; everything else releases it.
    fn sync_app_bar(&mut self, platform: &dyn Platform, label: &str) {
        let Some(window) = self.window_mut(label) else {
            return;
        };
        let wanted = (window.layout.mode == PlacementMode::Reserved
            && window.layout.enabled
            && window.ready
            && !window.debounce.is_parked())
        .then(|| layout::reserved_height(&window.monitor, &window.layout));
        if wanted == window.reserved {
            return;
        }
        let result = match wanted {
            Some(height) => platform
                .app_bar()
                .reserve_top(window.hwnd, window.monitor.bounds, height)
                .map(|_| ()),
            None => platform.app_bar().release(window.hwnd),
        };
        match result {
            Ok(()) => window.reserved = wanted,
            Err(error) => tracing::warn!(%error, label, "app bar update failed"),
        }
    }

    /// Releases every `AppBar` reservation (process exit).
    pub fn release_app_bars(&mut self, platform: &dyn Platform) {
        for window in &mut self.windows {
            if window.reserved.take().is_some()
                && let Err(error) = platform.app_bar().release(window.hwnd)
            {
                tracing::warn!(%error, label = window.label, "app bar release failed");
            }
        }
    }

    // --- cursor ---------------------------------------------------------------------------

    /// One cursor sample across every ready window. The click-through toggles must be applied
    /// **outside** the lock (`SetWindowLongPtr` is a synchronous message to the window's
    /// thread, docs/spikes/m0-window.md).
    ///
    /// Two shell rules live here rather than in [`HitTester`], because they span windows:
    ///
    /// - The poll runs at the active rate while any window publishes more than one shape (the
    ///   UI adds a second rect only while revealed, open or morphing), so a click anywhere on
    ///   screen is seen within one tick and never falls between two 100 ms samples.
    /// - A mouse button going down while the cursor is outside every shape of a window is
    ///   reported as a press outside for that window: the window is click-through there, so
    ///   the UI cannot observe the press itself.
    pub fn poll_cursor(&mut self, cursor: (i32, i32), button_down: bool) -> CursorPoll {
        let pressed = button_down && !self.pointer_button_was_down;
        self.pointer_button_was_down = button_down;
        let mut poll = CursorPoll::default();
        // A tracked window drag is followed at the active rate whatever the hit tester says:
        // the zones must appear within a frame of the cursor arriving.
        if self.snapping {
            poll.rate = PollRate::Active;
        }
        for window in self.windows.iter_mut().filter(|w| w.ready) {
            let decision = window.hit_tester.observe(cursor, window.rect);
            if decision.rate == PollRate::Active || window.css_shapes.len() > 1 {
                poll.rate = PollRate::Active;
            }
            if let Some(ignore) = decision.set_ignore {
                poll.toggles.push((window.hwnd, ignore));
            }
            if pressed && window.hit_tester.is_ignoring() {
                poll.pressed_outside.push(window.label.clone());
            }
            if self.snapping
                && poll.snap_over.is_none()
                && !window.debounce.is_parked()
                && window.rect.contains(cursor.0, cursor.1)
            {
                poll.snap_over = Some(SnapOver {
                    label: window.label.clone(),
                    x: cursor.0 - window.rect.x,
                    y: cursor.1 - window.rect.y,
                });
            }
        }
        poll
    }
}

/// Where a tracked window drag is, relative to one notch window's client area, in physical
/// pixels (the manager converts to CSS pixels for the UI).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapOver {
    pub label: String,
    pub x: i32,
    pub y: i32,
}

/// Result of one [`ShellModel::poll_cursor`] tick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorPoll {
    /// Rate for the next sample.
    pub rate: PollRate,
    /// `set_click_through(window, ignore)` calls to make outside the lock.
    pub toggles: Vec<(WindowHandle, bool)>,
    /// Labels of the windows that must receive `ShellPointerDownOutside`.
    pub pressed_outside: Vec<String>,
    /// While a snap drag is tracked: the notch window under the cursor, if any.
    pub snap_over: Option<SnapOver>,
}

impl Default for CursorPoll {
    fn default() -> Self {
        Self {
            rate: PollRate::Idle,
            toggles: Vec::new(),
            pressed_outside: Vec::new(),
            snap_over: None,
        }
    }
}
