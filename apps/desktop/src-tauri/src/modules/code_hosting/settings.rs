//! The module's settings namespace, `settings.modules["code-hosting"]`
//! (docs/modules/code-hosting.md). Off by default: the module makes no request until the
//! user turns it on and connects an account (`.github/copilot-instructions.md`, "no network
//! calls without an explicit user-enabled integration"). The token itself never lives here —
//! it is in the credential vault under [`super::TOKEN_KEY`]. A missing or malformed entry
//! yields the defaults instead of failing the whole document, and unknown keys are ignored so
//! an older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Which strip notices the module publishes (docs/modules/code-hosting.md "Strip").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct NoticeSettings {
    /// Someone asked for the user's review.
    pub review_requested: bool,
    /// The checks on a pull request the user opened finished.
    pub checks_finished: bool,
}

impl Default for NoticeSettings {
    fn default() -> Self {
        Self {
            review_requested: true,
            checks_finished: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct CodeHostingSettings {
    /// Whether the module polls at all. Off until the user turns it on.
    pub enabled: bool,
    pub notices: NoticeSettings,
}

impl CodeHostingSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "code hosting settings malformed; using defaults");
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
