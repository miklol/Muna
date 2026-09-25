//! The module's settings namespace, `settings.modules.media` (docs/modules/media.md,
//! "Settings"). Each module validates its own namespace (docs/03-architecture.md): a missing
//! or malformed entry yields the defaults instead of failing the whole document, and unknown
//! keys are ignored so an older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Strip bars beside the artwork while playing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Visualiser {
    /// Four bars, animated while playing (docs/06-motion-spec.md "Waveform").
    #[default]
    Bars,
    /// No trailing slot while playing; the paused glyph still shows.
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct MediaSettings {
    /// `source_app_id` to show while it has a session; `None` follows the scoring ("Auto").
    /// Pinning from the panel writes it too, so the choice survives a relaunch.
    pub preferred_app: Option<String>,
    /// Tint the strip halo and the panel gradient with the artwork palette.
    pub adaptive_colours: bool,
    pub visualiser: Visualiser,
}

impl Default for MediaSettings {
    fn default() -> Self {
        Self {
            preferred_app: None,
            adaptive_colours: true,
            visualiser: Visualiser::Bars,
        }
    }
}

impl MediaSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "media settings malformed; using defaults");
            Self::default()
        })
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }
}
