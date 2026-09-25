//! The module's settings namespace, `settings.modules.hud` (docs/modules/hud.md). A missing
//! or malformed entry yields the defaults instead of failing the whole document, and unknown
//! keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// What the scroll wheel does over the collapsed strip (docs/modules/hud.md, "Interaction").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ScrollOnStrip {
    /// Scrolling opens the panel (the shell's default); volume only while the HUD shows.
    #[default]
    Panel,
    /// Scrolling always nudges the volume.
    Volume,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct HudSettings {
    /// Hide the Windows volume/brightness flyout while Muna runs. Best effort: on builds where
    /// no flyout window exists the HUD still shows and nothing else changes.
    pub replace_system_flyout: bool,
    pub scroll_on_strip: ScrollOnStrip,
    /// Show the percentage beside the level track.
    pub show_level_text: bool,
}

impl Default for HudSettings {
    fn default() -> Self {
        Self {
            replace_system_flyout: true,
            scroll_on_strip: ScrollOnStrip::Panel,
            show_level_text: false,
        }
    }
}

impl HudSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "hud settings malformed; using defaults");
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
