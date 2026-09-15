//! Click-through state machine (docs/modules/notch-shell.md, Rendering & hit-testing).
//!
//! The notch window covers a large transparent area; only the painted shapes may receive the
//! pointer. Tauri offers no hover-forwarding click-through (tauri #6164), so Rust samples the
//! cursor and toggles `set_ignore_cursor_events`: **60 Hz while the cursor is inside the window
//! bounds, 10 Hz otherwise**, and events are re-enabled only while the cursor is over a shape
//! the UI published. No `WH_MOUSE_LL` hook (silently removed on slow callbacks).

use std::time::Duration;

use muna_platform::Rect;

/// How often to sample the cursor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollRate {
    /// Cursor outside every notch window.
    Idle,
    /// Cursor inside a window's bounds (possibly over transparent pixels).
    Active,
}

impl PollRate {
    #[must_use]
    pub const fn interval(self) -> Duration {
        match self {
            Self::Idle => Duration::from_millis(100),
            Self::Active => Duration::from_micros(16_667),
        }
    }
}

/// What the caller must do after one sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Decision {
    /// `Some(value)` when `set_ignore_cursor_events(value)` must be called.
    pub set_ignore: Option<bool>,
    pub rate: PollRate,
}

/// Per-window hit tester. Starts in the state Tauri creates the window in (cursor events
/// enabled) and converges on the first sample.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HitTester {
    shapes: Vec<Rect>,
    ignoring: bool,
}

impl Default for HitTester {
    fn default() -> Self {
        Self::new()
    }
}

impl HitTester {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            shapes: Vec::new(),
            ignoring: false,
        }
    }

    /// Replaces the painted shapes (physical screen rects) published by the UI.
    pub fn set_shapes(&mut self, shapes: Vec<Rect>) {
        self.shapes = shapes;
    }

    #[must_use]
    pub fn shapes(&self) -> &[Rect] {
        &self.shapes
    }

    /// `true` while the window passes pointer events through.
    #[must_use]
    pub const fn is_ignoring(&self) -> bool {
        self.ignoring
    }

    /// Feeds one cursor sample (physical screen pixels) against the window's current bounds.
    pub fn observe(&mut self, cursor: (i32, i32), window: Rect) -> Decision {
        let (x, y) = cursor;
        let over_shape = self.shapes.iter().any(|shape| shape.contains(x, y));
        let want_ignore = !over_shape;
        let set_ignore = (want_ignore != self.ignoring).then_some(want_ignore);
        self.ignoring = want_ignore;
        Decision {
            set_ignore,
            rate: if window.contains(x, y) {
                PollRate::Active
            } else {
                PollRate::Idle
            },
        }
    }
}

/// Number of samples per second at each rate, for the spike report.
#[must_use]
pub fn samples_per_second(rate: PollRate) -> u32 {
    let micros = rate.interval().as_micros().max(1);
    u32::try_from(1_000_000_u128 / micros).unwrap_or(u32::MAX)
}
