//! The module's settings namespace, `settings.modules.shelf` (docs/modules/shelf.md
//! "Behaviour": *Copy files into Shelf storage* and how long items stay). A missing or
//! malformed entry yields the defaults instead of failing the whole document, and unknown keys
//! are ignored so an older build can read a newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Longest expiry the setting accepts, in days.
pub const MAX_EXPIRY_DAYS: u16 = 365;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct ShelfSettings {
    /// Copy dropped files into `%LOCALAPPDATA%\miklol\Muna\shelf` instead of referencing them, so
    /// the item survives the original being moved or deleted.
    pub copy_into_storage: bool,
    /// Remove items this many days after they arrived; `0` keeps them until removed.
    pub expiry_days: u16,
}

impl ShelfSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "shelf settings malformed; using defaults");
                Self::default()
            })
            .normalised()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// Caps the expiry at [`MAX_EXPIRY_DAYS`].
    #[must_use]
    pub fn normalised(self) -> Self {
        Self {
            copy_into_storage: self.copy_into_storage,
            expiry_days: self.expiry_days.min(MAX_EXPIRY_DAYS),
        }
    }

    /// The expiry as milliseconds, `None` for *never*.
    #[must_use]
    pub fn expiry_ms(&self) -> Option<i64> {
        (self.expiry_days > 0).then(|| i64::from(self.expiry_days) * 24 * 60 * 60 * 1000)
    }
}
