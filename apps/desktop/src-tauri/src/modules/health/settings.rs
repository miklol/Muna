//! The module's settings namespace, `settings.modules.health` (docs/modules/health.md). A
//! missing or malformed entry yields the defaults instead of failing the whole document, and
//! unknown keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Bounds the UI offers and the module clamps to: minutes of sitting between break reminders.
pub const BREAK_EVERY_MINUTES: (u8, u8) = (15, 180);
/// Glasses of water a day.
pub const WATER_GOAL: (u8, u8) = (1, 20);
/// The evening hour from which the notch winds down (`None` never does).
pub const WIND_DOWN_HOUR: (u8, u8) = (18, 23);

/// How the Breathe flow paces itself (docs/modules/health.md: "box-breathing 4-4-4-4 or
/// 4-7-8").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum BreathePattern {
    /// In 4 s, hold 4 s, out 4 s, hold 4 s.
    #[default]
    Box,
    /// In 4 s, hold 7 s, out 8 s.
    Relax,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct HealthSettings {
    /// Track sitting and remind about breaks. On by default: nothing leaves the machine and
    /// the counters are one tap to clear; off stops the timer and every nudge.
    pub enabled: bool,
    /// Minutes of sitting before the break reminder.
    pub break_every_min: u8,
    /// Glasses of water a day; fills the blue ring.
    pub water_goal: u8,
    /// The local hour from which the panel reports winding down; `None` never does.
    pub wind_down_hour: Option<u8>,
    /// Warn after ten minutes above 85 % volume on headphones.
    pub hearing_warning: bool,
    /// The Breathe flow's pacing.
    pub breathe_pattern: BreathePattern,
}

impl Default for HealthSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            break_every_min: 50,
            water_goal: 8,
            wind_down_hour: None,
            hearing_warning: true,
            breathe_pattern: BreathePattern::Box,
        }
    }
}

impl HealthSettings {
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
                tracing::warn!(%error, "health settings malformed; using defaults");
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
            break_every_min: self
                .break_every_min
                .clamp(BREAK_EVERY_MINUTES.0, BREAK_EVERY_MINUTES.1),
            water_goal: self.water_goal.clamp(WATER_GOAL.0, WATER_GOAL.1),
            wind_down_hour: self
                .wind_down_hour
                .map(|hour| hour.clamp(WIND_DOWN_HOUR.0, WIND_DOWN_HOUR.1)),
            ..self
        }
    }
}
