//! The module's settings namespace, `settings.modules["ai-coding"]` (docs/modules/ai-coding.md).
//! A missing or malformed entry yields the defaults instead of failing the whole document, and
//! unknown keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// The loopback port the hook receiver asks for first. Hook URLs are static configuration in
/// the agents' own settings files, so the port is a setting rather than a random pick; when it
/// is taken the receiver tries the next [`PORT_ATTEMPTS`] and the pane shows the live one.
pub const DEFAULT_PORT: u16 = 47391;
/// How many consecutive ports are tried after the configured one.
pub const PORT_ATTEMPTS: u16 = 10;
/// Ports below 1024 need elevation on most systems; the module never asks for them.
pub const PORT_RANGE: (u16, u16) = (1024, u16::MAX - PORT_ATTEMPTS);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct AiCodingSettings {
    /// Watch coding agents. On by default: the receiver listens on loopback only and nothing
    /// is read until an agent writes a session or posts a hook.
    pub enabled: bool,
    /// The loopback port the receiver binds (see [`DEFAULT_PORT`]).
    pub port: u16,
    /// Follow GitHub Copilot CLI sessions from `%USERPROFILE%\.copilot\session-state`.
    pub copilot_cli: bool,
    /// Show a strip notice (with *Allow* / *Deny* when the agent offers a decision) when a
    /// session stops for the user. Off keeps the sessions in the panel and the widget only.
    pub waiting_notice: bool,
}

impl Default for AiCodingSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            port: DEFAULT_PORT,
            copilot_cli: true,
            waiting_notice: true,
        }
    }
}

impl AiCodingSettings {
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
                tracing::warn!(%error, "ai coding settings malformed; using defaults");
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
            port: self.port.clamp(PORT_RANGE.0, PORT_RANGE.1),
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
            AiCodingSettings::from_document(&settings),
            AiCodingSettings::default()
        );
        let mut broken = Settings::default();
        broken.modules.insert(
            AiCodingSettings::KEY.to_owned(),
            serde_json::json!({ "port": "soon" }),
        );
        assert_eq!(
            AiCodingSettings::from_document(&broken),
            AiCodingSettings::default()
        );
    }

    #[test]
    fn values_are_clamped_and_unknown_keys_ignored() {
        let mut settings = Settings::default();
        settings.modules.insert(
            AiCodingSettings::KEY.to_owned(),
            serde_json::json!({ "enabled": false, "port": 80, "copilotCli": false, "later": 1 }),
        );
        let read = AiCodingSettings::from_document(&settings);
        assert_eq!(
            read,
            AiCodingSettings {
                enabled: false,
                port: PORT_RANGE.0,
                copilot_cli: false,
                waiting_notice: true,
            }
        );
        let mut out = Settings::default();
        read.write(&mut out).unwrap();
        assert_eq!(AiCodingSettings::from_document(&out), read);
    }
}
