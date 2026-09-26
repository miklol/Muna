//! The module's settings namespace, `settings.modules["day-progress"]`
//! (docs/modules/day-progress.md). A missing or malformed entry yields the defaults instead of
//! failing the whole document, and unknown keys are ignored so an older build can read a newer
//! file (docs/03-architecture.md).
//!
//! Times of day are minutes since local midnight (`540` is 09:00) so both sides clamp and
//! compare them as plain integers; the settings pane formats them for the locale.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Minutes in a day; every time of day is below this.
pub const MINUTES_PER_DAY: u16 = 24 * 60;
/// The last minute of the day a time may name.
pub const LAST_MINUTE: u16 = MINUTES_PER_DAY - 1;
/// The shortest working day the pane offers: one step of its time sliders.
pub const MIN_WORKING_MINUTES: u16 = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct DayProgressSettings {
    /// When the working day starts, minutes since local midnight.
    pub work_start_minutes: u16,
    /// When the working day ends, minutes since local midnight; always after the start.
    pub work_end_minutes: u16,
    /// An optional bedtime marker at the end of the timeline, minutes since local midnight.
    pub bedtime_minutes: Option<u16>,
    /// Keep a progress bar of the working day in the collapsed strip. Off by default: the
    /// resting notch stays the bare black shape unless the user asks for it.
    pub show_day_in_strip: bool,
    /// Whether tasks with a due time today appear on the timeline.
    pub show_tasks: bool,
    /// Whether the running focus session and today's count appear on the timeline.
    pub show_focus_sessions: bool,
}

impl Default for DayProgressSettings {
    fn default() -> Self {
        Self {
            work_start_minutes: 9 * 60,
            work_end_minutes: 18 * 60,
            bedtime_minutes: None,
            show_day_in_strip: false,
            show_tasks: true,
            show_focus_sessions: true,
        }
    }
}

impl DayProgressSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, clamped to a valid day.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "day progress settings malformed; using defaults");
                Self::default()
            })
            .clamped()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// Every time inside the day, and a working day that ends after it starts; a window that
    /// cannot be repaired (a start at the last minute) falls back to the default hours.
    #[must_use]
    pub fn clamped(self) -> Self {
        let defaults = Self::default();
        let work_start_minutes = self.work_start_minutes.min(LAST_MINUTE);
        let work_end_minutes = self.work_end_minutes.min(LAST_MINUTE);
        let (work_start_minutes, work_end_minutes) =
            if work_end_minutes >= work_start_minutes.saturating_add(MIN_WORKING_MINUTES) {
                (work_start_minutes, work_end_minutes)
            } else if let Some(end) = work_start_minutes
                .checked_add(MIN_WORKING_MINUTES)
                .filter(|end| *end <= LAST_MINUTE)
            {
                (work_start_minutes, end)
            } else {
                (defaults.work_start_minutes, defaults.work_end_minutes)
            };
        Self {
            work_start_minutes,
            work_end_minutes,
            bedtime_minutes: self.bedtime_minutes.map(|minutes| minutes.min(LAST_MINUTE)),
            ..self
        }
    }
}
