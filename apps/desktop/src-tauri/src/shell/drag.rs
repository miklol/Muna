//! Bookkeeping for OLE drags over the notch windows (docs/spikes/m4-drop.md). wry reports one
//! *over* per mouse move; keeping a summary per window lets the manager log a single line when
//! the drag leaves or drops instead of sixty a second, and coalesces the moves it forwards to
//! the UI to one per frame ([`MOVE_INTERVAL`]). Paths are never stored here.

use std::collections::HashMap;
use std::fmt;
use std::time::{Duration, Instant};

/// Least time between two `DropMoved` events for one window: one 60 Hz frame.
pub const MOVE_INTERVAL: Duration = Duration::from_millis(16);

/// A position in physical pixels relative to the window's client area.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DragPoint {
    pub x: f64,
    pub y: f64,
}

impl DragPoint {
    #[must_use]
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

impl fmt::Display for DragPoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "({:.0},{:.0})", self.x, self.y)
    }
}

/// What one drag did between *enter* and *leave* / *drop*.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct DragSummary {
    /// Number of *over* events after the *enter*.
    pub overs: u32,
    entered_at: Option<DragPoint>,
    last_at: Option<DragPoint>,
    /// When the last move was forwarded to the UI; `None` until the first one.
    forwarded_at: Option<Instant>,
}

/// Shown as `(x,y)` or `-` when the drag never reported the position.
#[derive(Debug, Clone, Copy)]
pub struct DisplayPoint(Option<DragPoint>);

impl fmt::Display for DisplayPoint {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(point) => point.fmt(f),
            None => f.write_str("-"),
        }
    }
}

impl DragSummary {
    /// Where the drag entered.
    #[must_use]
    pub const fn first(&self) -> DisplayPoint {
        DisplayPoint(self.entered_at)
    }

    /// The last position reported (the *enter* position when nothing moved).
    #[must_use]
    pub const fn last(&self) -> DisplayPoint {
        DisplayPoint(self.last_at)
    }

    /// The last position as a point, if any.
    #[must_use]
    pub const fn last_point(&self) -> Option<DragPoint> {
        self.last_at
    }
}

/// In-flight drags keyed by window label.
#[derive(Debug, Default)]
pub struct DragLog {
    drags: HashMap<String, DragSummary>,
}

impl DragLog {
    /// A drag entered `label` at `(x, y)`; replaces a summary left behind by a missed *leave*.
    pub fn enter(&mut self, label: &str, x: f64, y: f64) {
        let point = DragPoint { x, y };
        self.drags.insert(
            label.to_owned(),
            DragSummary {
                overs: 0,
                entered_at: Some(point),
                last_at: Some(point),
                forwarded_at: None,
            },
        );
    }

    /// The drag over `label` moved. An *over* without an *enter* starts a summary so the
    /// leave line still says something.
    pub fn over(&mut self, label: &str, x: f64, y: f64) {
        let summary = self.drags.entry(label.to_owned()).or_default();
        summary.overs += 1;
        summary.last_at = Some(DragPoint { x, y });
    }

    /// The drag over `label` ended (left or dropped); returns and forgets its summary.
    pub fn finish(&mut self, label: &str) -> DragSummary {
        self.drags.remove(label).unwrap_or_default()
    }

    /// The latest position over `label` when at least [`MOVE_INTERVAL`] passed since the last
    /// one handed out (or none was yet); `None` while the frame is still fresh, so a stream of
    /// *over* events becomes at most one `DropMoved` per frame.
    pub fn take_move_if_due(&mut self, label: &str, now: Instant) -> Option<DragPoint> {
        let summary = self.drags.get_mut(label)?;
        let point = summary.last_at?;
        if summary
            .forwarded_at
            .is_some_and(|at| now.duration_since(at) < MOVE_INTERVAL)
        {
            return None;
        }
        summary.forwarded_at = Some(now);
        Some(point)
    }

    /// Whether a drag is currently over `label`.
    #[must_use]
    pub fn is_dragging(&self, label: &str) -> bool {
        self.drags.contains_key(label)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_drag_is_summarised_between_enter_and_finish() {
        let mut log = DragLog::default();
        log.enter("notch", 10.0, 4.0);
        assert!(log.is_dragging("notch"));
        log.over("notch", 12.0, 4.0);
        log.over("notch", 14.0, 5.0);
        let summary = log.finish("notch");
        assert_eq!(summary.overs, 2);
        assert_eq!(summary.first().to_string(), "(10,4)");
        assert_eq!(summary.last().to_string(), "(14,5)");
        assert!(!log.is_dragging("notch"));
    }

    #[test]
    fn finishing_an_unknown_drag_is_empty() {
        let mut log = DragLog::default();
        let summary = log.finish("notch-2");
        assert_eq!(summary.overs, 0);
        assert_eq!(summary.first().to_string(), "-");
        assert_eq!(summary.last_point(), None);
    }

    #[test]
    fn an_over_without_enter_still_counts() {
        let mut log = DragLog::default();
        log.over("notch", 1.0, 1.0);
        let summary = log.finish("notch");
        assert_eq!(summary.overs, 1);
        assert_eq!(summary.first().to_string(), "-");
        assert_eq!(summary.last().to_string(), "(1,1)");
    }

    #[test]
    fn windows_are_tracked_independently() {
        let mut log = DragLog::default();
        log.enter("notch", 0.0, 0.0);
        log.enter("notch-2", 5.0, 5.0);
        log.over("notch-2", 6.0, 6.0);
        assert_eq!(log.finish("notch").overs, 0);
        assert!(log.is_dragging("notch-2"));
        assert_eq!(log.finish("notch-2").overs, 1);
    }
}
