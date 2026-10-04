//! The module's settings namespace, `settings.modules["screen-time"]`
//! (docs/modules/screen-time.md). A missing or malformed entry yields the defaults instead of
//! failing the whole document, and unknown keys are ignored so an older build can read a
//! newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Bounds the UI offers and the module clamps to: minutes without input before attribution
/// pauses.
pub const IDLE_MINUTES: (u8, u8) = (1, 60);
/// Hours: the day rolls over at this local hour (0 is midnight, 4 keeps a late night on the
/// day it started).
pub const DAY_RESET_HOUR: (u8, u8) = (0, 23);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ScreenTimeSettings {
    /// Record the foreground app. On by default: the data never leaves the machine and is one
    /// tap to clear; off closes the open span and records nothing.
    pub enabled: bool,
    /// Minutes without keyboard or mouse input before the current app stops accruing time.
    pub idle_minutes: u8,
    /// The local hour at which "today" starts.
    pub day_reset_hour: u8,
}

impl Default for ScreenTimeSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            idle_minutes: 5,
            day_reset_hour: 0,
        }
    }
}

impl ScreenTimeSettings {
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
                tracing::warn!(%error, "screen time settings malformed; using defaults");
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
            idle_minutes: self.idle_minutes.clamp(IDLE_MINUTES.0, IDLE_MINUTES.1),
            day_reset_hour: self
                .day_reset_hour
                .clamp(DAY_RESET_HOUR.0, DAY_RESET_HOUR.1),
            ..self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_apply_for_a_missing_or_broken_namespace() {
        let settings = Settings::default();
        assert_eq!(
            ScreenTimeSettings::from_document(&settings),
            ScreenTimeSettings::default()
        );
        let mut broken = Settings::default();
        broken.modules.insert(
            ScreenTimeSettings::KEY.to_owned(),
            serde_json::json!({ "idleMinutes": "soon" }),
        );
        assert_eq!(
            ScreenTimeSettings::from_document(&broken),
            ScreenTimeSettings::default()
        );
    }

    #[test]
    fn values_are_clamped_and_unknown_keys_ignored() {
        let mut settings = Settings::default();
        settings.modules.insert(
            ScreenTimeSettings::KEY.to_owned(),
            serde_json::json!({ "enabled": false, "idleMinutes": 0, "dayResetHour": 30, "later": 1 }),
        );
        let read = ScreenTimeSettings::from_document(&settings);
        assert_eq!(
            read,
            ScreenTimeSettings {
                enabled: false,
                idle_minutes: 1,
                day_reset_hour: 23,
            }
        );
        let mut out = Settings::default();
        read.write(&mut out).unwrap();
        assert_eq!(ScreenTimeSettings::from_document(&out), read);
    }
}
