//! The module's settings namespace, `settings.modules["system-monitor"]`
//! (docs/modules/system-monitor.md). A missing or malformed entry yields the defaults instead
//! of failing the whole document, and unknown keys are ignored so an older build can read a
//! newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Bounds the UI offers and the module clamps to: how many process rows the panel lists.
pub const PROCESS_COUNT: (u8, u8) = (0, 10);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct SystemMonitorSettings {
    /// Keep a CPU gauge in the collapsed strip, sampled every 10 s. Off by default: it is
    /// ambient telemetry, and the module must cost nothing when nobody is looking.
    pub show_cpu_in_strip: bool,
    /// How many of the busiest processes the panel lists; 0 skips the process walk entirely.
    pub process_count: u8,
}

impl Default for SystemMonitorSettings {
    fn default() -> Self {
        Self {
            show_cpu_in_strip: false,
            process_count: 5,
        }
    }
}

impl SystemMonitorSettings {
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
                tracing::warn!(%error, "system monitor settings malformed; using defaults");
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
            process_count: self.process_count.clamp(PROCESS_COUNT.0, PROCESS_COUNT.1),
            ..self
        }
    }
}
