//! The module's settings namespace, `settings.modules.pomodoro` (docs/modules/pomodoro.md). A
//! missing or malformed entry yields the defaults instead of failing the whole document, and
//! unknown keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use std::time::Duration;

use muna_core::{PomodoroPhase, Settings};
use serde::{Deserialize, Serialize};
use specta::Type;

/// Bounds the UI offers and the module clamps to, in minutes.
pub const WORK_MINUTES: (u16, u16) = (5, 90);
pub const SHORT_BREAK_MINUTES: (u16, u16) = (1, 30);
pub const LONG_BREAK_MINUTES: (u16, u16) = (5, 60);
pub const LONG_BREAK_EVERY: (u8, u8) = (2, 8);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct PomodoroSettings {
    pub work_minutes: u16,
    pub short_break_minutes: u16,
    pub long_break_minutes: u16,
    /// Work phases per cycle; the break after the last one is the long one.
    pub long_break_every: u8,
    /// Start the next phase as soon as one runs out.
    pub auto_start_next: bool,
}

impl Default for PomodoroSettings {
    fn default() -> Self {
        Self {
            work_minutes: 25,
            short_break_minutes: 5,
            long_break_minutes: 15,
            long_break_every: 4,
            auto_start_next: false,
        }
    }
}

impl PomodoroSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, clamped to the bounds above.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "pomodoro settings malformed; using defaults");
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

    #[must_use]
    pub fn clamped(self) -> Self {
        Self {
            work_minutes: self.work_minutes.clamp(WORK_MINUTES.0, WORK_MINUTES.1),
            short_break_minutes: self
                .short_break_minutes
                .clamp(SHORT_BREAK_MINUTES.0, SHORT_BREAK_MINUTES.1),
            long_break_minutes: self
                .long_break_minutes
                .clamp(LONG_BREAK_MINUTES.0, LONG_BREAK_MINUTES.1),
            long_break_every: self
                .long_break_every
                .clamp(LONG_BREAK_EVERY.0, LONG_BREAK_EVERY.1),
            auto_start_next: self.auto_start_next,
        }
    }

    /// How long one phase runs.
    #[must_use]
    pub fn duration(&self, phase: PomodoroPhase) -> Duration {
        let minutes = match phase {
            PomodoroPhase::Work => self.work_minutes,
            PomodoroPhase::ShortBreak => self.short_break_minutes,
            PomodoroPhase::LongBreak => self.long_break_minutes,
        };
        Duration::from_secs(u64::from(minutes) * 60)
    }
}
