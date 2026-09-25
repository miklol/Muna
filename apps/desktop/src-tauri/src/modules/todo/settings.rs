//! The module's settings namespace, `settings.modules.todo` (docs/modules/todo.md). A missing
//! or malformed entry yields the defaults instead of failing the whole document, and unknown
//! keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use std::time::Duration;

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Bounds the UI offers and the module clamps to, in days.
pub const RETENTION_DAYS: (u16, u16) = (1, 365);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct TodoSettings {
    /// How long a trashed task can be restored before it is purged.
    pub retention_days: u16,
    /// Announce a task in the strip at its due time.
    pub due_notices: bool,
    /// Show the next task due within the hour as a strip activity.
    pub show_due_in_strip: bool,
}

impl Default for TodoSettings {
    fn default() -> Self {
        Self {
            retention_days: 30,
            due_notices: true,
            show_due_in_strip: true,
        }
    }
}

impl TodoSettings {
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
                tracing::warn!(%error, "todo settings malformed; using defaults");
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
            retention_days: self
                .retention_days
                .clamp(RETENTION_DAYS.0, RETENTION_DAYS.1),
            ..self
        }
    }

    /// The retention period as a duration.
    #[must_use]
    pub fn retention(&self) -> Duration {
        Duration::from_secs(u64::from(self.retention_days) * 24 * 3600)
    }
}
