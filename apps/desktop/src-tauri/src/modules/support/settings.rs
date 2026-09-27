//! The module's settings namespace, `settings.modules.support` (docs/modules/support.md): the
//! update channel and the crash-report opt-in. A missing or malformed entry yields the defaults
//! instead of failing the whole document, and unknown keys are ignored so an older build can
//! read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Which release feed *Check for updates* reads. Beta is a pre-release tag whose `latest.json`
/// the release workflow republishes; stable is the GitHub *latest* release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum UpdateChannel {
    #[default]
    Stable,
    Beta,
}

impl UpdateChannel {
    /// The updater manifest this channel reads. The stable address is the one
    /// `tauri.conf.json` ships; the beta address is the hook the release workflow wires
    /// (docs/10-release-distribution.md).
    #[must_use]
    pub const fn endpoint(self) -> &'static str {
        match self {
            Self::Stable => "https://github.com/miklol/Muna/releases/latest/download/latest.json",
            Self::Beta => "https://github.com/miklol/Muna/releases/download/beta/latest.json",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct SupportSettings {
    pub channel: UpdateChannel,
    /// Reserved for the opt-in crash reporter (docs/modules/support.md). No reporter ships in
    /// 1.0, so this stays `false` and nothing reads it.
    pub crash_reports: bool,
}

impl SupportSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "support settings malformed; using defaults");
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
