//! The module's settings namespace, `settings.modules.notes` (docs/modules/notes.md). Only the
//! folder lives here: `None` means the default (`%APPDATA%\Muna\notes`), a path points at any
//! folder of Markdown files — an Obsidian vault included. A missing or malformed entry yields
//! the defaults instead of failing the whole document, and unknown keys are ignored so an
//! older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct NotesSettings {
    /// The folder the notes live in; `None` is the default folder. Trimmed; blank is `None`.
    pub folder: Option<String>,
}

impl NotesSettings {
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
                tracing::warn!(%error, "notes settings malformed; using defaults");
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

    /// A blank folder is the default folder.
    #[must_use]
    pub fn normalised(self) -> Self {
        Self {
            folder: self
                .folder
                .map(|folder| folder.trim().to_owned())
                .filter(|folder| !folder.is_empty()),
        }
    }
}
