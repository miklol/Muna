//! Yield rules (docs/modules/notch-shell.md, Placement → "Yield rules"): pure decisions from
//! what the platform reports to what one notch window should do. No timers, no OS calls, so
//! every rule is a plain `cargo test` against scripted inputs.
//!
//! Precedence, highest first: paused display / locked session / fullscreen → *Park*; a file
//! drag over this window → *None* (the drop tiles need the strip in place); a window drag the
//! Window snap module is tracking → *None* (the snap zones need it too); any other window drag
//! or caption overlap → *Peek*; otherwise *None*. Parking is debounced by the caller
//! ([`ParkDebounce`], 500 ms, "flapping fullscreen detection never flickers"); Peek is not
//! (the acceptance criterion is "yields within 100 ms").

use std::time::{Duration, Instant};

use muna_core::PlacementMode;
use muna_platform::{ForegroundWindow, MonitorInfo, Rect, UserNotificationState};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Fraction of the strip's width a foreground window must overlap before the strip peeks
/// (`caption_overlaps` uses the equivalent integer test).
pub const CAPTION_OVERLAP_THRESHOLD: f64 = 0.4;
/// How long a park/unpark decision must hold before it is applied.
pub const PARK_DEBOUNCE: Duration = Duration::from_millis(500);

/// What one notch window does about the world around it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum YieldState {
    /// Nothing in the way.
    #[default]
    None,
    /// A title bar or a window drag is under the strip: the UI slides the strip up to 6 px.
    Peek,
    /// Fullscreen, locked or paused: the window is moved above the monitor and the UI pauses.
    Parked,
}

/// Everything the rules look at for one monitor.
///
/// The flags are independent observations from different Win32 sources (a window drag and an
/// OLE file drag, a locked session and a user pause can each coexist), not a state machine.
#[allow(clippy::struct_excessive_bools)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct YieldInputs<'a> {
    pub mode: PlacementMode,
    /// The monitor this window lives on.
    pub monitor: &'a MonitorInfo,
    /// Every monitor, to attribute the foreground window to exactly one of them.
    pub monitors: &'a [MonitorInfo],
    /// Strip rect in physical screen px (the published shape, or the default strip).
    pub strip: Rect,
    /// Foreground window, already filtered so Muna's own windows are `None`.
    pub foreground: Option<&'a ForegroundWindow>,
    /// Latest `SHQueryUserNotificationState` sample.
    pub quiet: UserNotificationState,
    /// A window is being dragged or resized somewhere (`EVENT_SYSTEM_MOVESIZESTART`).
    pub moving: bool,
    /// That drag is a snap candidate the Window snap module wants the hot zone for
    /// (docs/modules/notch-shell.md: "Peek unless the Window-snap module wants the hot zone").
    pub snapping: bool,
    /// A file drag (OLE) is over this window: the drop tiles are showing, so nothing short of
    /// a park may move the strip (docs/build-plan/m4-power-tools.md "Risks").
    pub dragging: bool,
    /// The session is locked (`WTS_SESSION_LOCK`).
    pub locked: bool,
    /// The user paused the notch on this display (tray menu).
    pub paused: bool,
}

/// Decides the yield state for one window.
#[must_use]
pub fn decide(inputs: &YieldInputs<'_>) -> YieldState {
    if inputs.paused || inputs.locked || inputs.quiet == UserNotificationState::Presentation {
        return YieldState::Parked;
    }
    let foreground_here = inputs.foreground.filter(|window| {
        monitor_of(&window.bounds, inputs.monitors).is_some_and(|m| m.id == inputs.monitor.id)
    });
    if foreground_here.is_some() && is_fullscreen(foreground_here, inputs.quiet) {
        return YieldState::Parked;
    }
    if inputs.dragging {
        return YieldState::None;
    }
    if inputs.moving {
        return if inputs.snapping {
            YieldState::None
        } else {
            YieldState::Peek
        };
    }
    if inputs.mode == PlacementMode::Overlay
        && inputs
            .foreground
            .is_some_and(|window| caption_overlaps(&window.bounds, inputs.strip))
    {
        return YieldState::Peek;
    }
    YieldState::None
}

/// Fullscreen per the spec: the PILLAR heuristic on the foreground window **or** a quiet state
/// that parks (Busy/D3D need the heuristic to confirm them, Presentation stands alone).
#[must_use]
pub fn is_fullscreen(foreground: Option<&ForegroundWindow>, quiet: UserNotificationState) -> bool {
    let heuristic = foreground.map(|window| window.is_fullscreen);
    heuristic == Some(true) || quiet.should_park(heuristic)
}

/// A caption sits under the strip when the window's top edge is at or above the strip's
/// bottom and the window covers more than 40 % of the strip's width.
#[must_use]
pub fn caption_overlaps(window: &Rect, strip: Rect) -> bool {
    let strip_bottom = strip.y.saturating_add_unsigned(strip.height);
    let window_bottom = window.y.saturating_add_unsigned(window.height);
    if window.y > strip_bottom || window_bottom <= strip.y || strip.width == 0 {
        return false;
    }
    let overlap = i64::from(
        window
            .x
            .saturating_add_unsigned(window.width)
            .min(strip.x.saturating_add_unsigned(strip.width)),
    ) - i64::from(window.x.max(strip.x));
    // overlap / width > 0.4, in integers.
    overlap > 0 && overlap * 100 > i64::from(strip.width) * 40
}

/// The monitor holding most of `bounds` (largest intersection), if any.
#[must_use]
pub fn monitor_of<'m>(bounds: &Rect, monitors: &'m [MonitorInfo]) -> Option<&'m MonitorInfo> {
    monitors
        .iter()
        .map(|monitor| (monitor, intersection_area(bounds, &monitor.bounds)))
        .filter(|(_, area)| *area > 0)
        .max_by_key(|(_, area)| *area)
        .map(|(monitor, _)| monitor)
}

fn intersection_area(a: &Rect, b: &Rect) -> i64 {
    let width = i64::from(
        a.x.saturating_add_unsigned(a.width)
            .min(b.x.saturating_add_unsigned(b.width)),
    ) - i64::from(a.x.max(b.x));
    let height = i64::from(
        a.y.saturating_add_unsigned(a.height)
            .min(b.y.saturating_add_unsigned(b.height)),
    ) - i64::from(a.y.max(b.y));
    if width <= 0 || height <= 0 {
        0
    } else {
        width * height
    }
}

/// Debounces the *Parked* ↔ not-parked transition for one window. Peek never waits.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParkDebounce {
    applied_parked: bool,
    pending_since: Option<Instant>,
}

/// What [`ParkDebounce::observe`] asks the caller to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DebounceDecision {
    /// The state to show now (Peek/None pass straight through; Parked only once settled).
    pub effective: YieldState,
    /// `Some(when)`: the caller must re-evaluate at `when` for a pending park/unpark.
    pub recheck_at: Option<Instant>,
}

impl ParkDebounce {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            applied_parked: false,
            pending_since: None,
        }
    }

    /// `true` while the window is parked as far as the caller has applied it.
    #[must_use]
    pub const fn is_parked(&self) -> bool {
        self.applied_parked
    }

    /// Feeds the latest decision at `now`.
    pub fn observe(&mut self, desired: YieldState, now: Instant) -> DebounceDecision {
        let want_parked = desired == YieldState::Parked;
        if want_parked == self.applied_parked {
            self.pending_since = None;
            return DebounceDecision {
                effective: if self.applied_parked {
                    YieldState::Parked
                } else {
                    desired
                },
                recheck_at: None,
            };
        }
        let since = *self.pending_since.get_or_insert(now);
        if now.duration_since(since) >= PARK_DEBOUNCE {
            self.applied_parked = want_parked;
            self.pending_since = None;
            return DebounceDecision {
                effective: desired,
                recheck_at: None,
            };
        }
        DebounceDecision {
            // Until the transition settles the window keeps its previous park state: a pending
            // park shows nothing (a flapping fullscreen detection must not flicker the strip),
            // a pending unpark stays parked.
            effective: if self.applied_parked {
                YieldState::Parked
            } else {
                YieldState::None
            },
            recheck_at: Some(since + PARK_DEBOUNCE),
        }
    }

    /// Forgets any pending transition (settings changed, window re-created).
    pub fn reset(&mut self, parked: bool) {
        self.applied_parked = parked;
        self.pending_since = None;
    }
}
