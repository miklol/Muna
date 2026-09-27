//! The module's settings namespace, `settings.modules.translation`
//! (docs/modules/translation.md): the opt-in that lets text leave the machine, which provider
//! it goes to and where, and the language pair the panel opens with. Off by default: nothing is
//! sent until the user turns the module on (`.github/copilot-instructions.md`, "no network calls
//! without an explicit user-enabled integration"). The API key never lives here — it is in the
//! credential vault under [`TranslationProvider::key_entry`]. A missing or malformed entry yields the
//! defaults instead of failing the whole document, and unknown keys are ignored so an older
//! build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// The source language that means "let the provider detect it".
pub const AUTO: &str = "auto";
/// Longest endpoint or model string kept.
pub const FIELD_MAX: usize = 512;
/// Longest language tag kept (BCP-47 tags are short; `zh-Hant-TW` is ten characters).
pub const TAG_MAX: usize = 35;

/// Which wire the text goes over (docs/modules/translation.md "Providers"). Closed on purpose:
/// the UI maps each to a name, a default endpoint and a default model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum TranslationProvider {
    /// Any OpenAI-compatible chat endpoint (`OpenAI`, `Azure OpenAI`, `OpenRouter`, `LM Studio`).
    #[default]
    #[serde(rename = "openai")]
    OpenAi,
    /// A local (or LAN) Ollama server, `POST /api/chat`.
    Ollama,
}

impl TranslationProvider {
    /// The id the vault entry and the logs use.
    #[must_use]
    pub const fn id(self) -> &'static str {
        match self {
            Self::OpenAi => "openai",
            Self::Ollama => "ollama",
        }
    }

    /// Where requests go when `endpoint` is blank: the API base, without the route.
    #[must_use]
    pub const fn default_endpoint(self) -> &'static str {
        match self {
            Self::OpenAi => "https://api.openai.com/v1",
            Self::Ollama => "http://127.0.0.1:11434",
        }
    }

    /// The model asked for when `model` is blank.
    #[must_use]
    pub const fn default_model(self) -> &'static str {
        match self {
            Self::OpenAi => "gpt-4o-mini",
            Self::Ollama => "llama3.2",
        }
    }

    /// Whether a request without a key is refused before it is sent. Ollama has no keys; an
    /// OpenAI-compatible server may not need one either (LM Studio), but the hosted ones do, so
    /// the module asks for a key and lets the user save a placeholder for a server that ignores it.
    #[must_use]
    pub const fn needs_key(self) -> bool {
        match self {
            Self::OpenAi => true,
            Self::Ollama => false,
        }
    }

    /// The credential-vault entry the provider's key is kept under (`translation.openai.key`).
    #[must_use]
    pub fn key_entry(self) -> String {
        format!("translation.{}.key", self.id())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct TranslationSettings {
    /// The only switch that lets text leave the machine. Off by default.
    pub enabled: bool,
    pub provider: TranslationProvider,
    /// The API base the requests go to; blank means [`TranslationProvider::default_endpoint`].
    pub endpoint: String,
    /// The model asked for; blank means [`TranslationProvider::default_model`].
    pub model: String,
    /// BCP-47 tag of the language the text is in, or [`AUTO`].
    pub source: String,
    /// BCP-47 tag of the language to translate into.
    pub target: String,
}

impl Default for TranslationSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: TranslationProvider::OpenAi,
            endpoint: String::new(),
            model: String::new(),
            source: AUTO.to_owned(),
            target: "en".to_owned(),
        }
    }
}

impl TranslationSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, clipping over-long fields.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        let mut parsed = serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "translation settings malformed; using defaults");
            Self::default()
        });
        clip(&mut parsed.endpoint, FIELD_MAX);
        clip(&mut parsed.model, FIELD_MAX);
        clip(&mut parsed.source, TAG_MAX);
        clip(&mut parsed.target, TAG_MAX);
        if parsed.source.trim().is_empty() {
            AUTO.clone_into(&mut parsed.source);
        }
        if parsed.target.trim().is_empty() {
            "en".clone_into(&mut parsed.target);
        }
        parsed
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// The API base requests go to: the setting, trimmed of blanks and trailing slashes, or
    /// the provider's default.
    #[must_use]
    pub fn effective_endpoint(&self) -> String {
        let trimmed = self.endpoint.trim().trim_end_matches('/');
        if trimmed.is_empty() {
            self.provider.default_endpoint().to_owned()
        } else {
            trimmed.to_owned()
        }
    }

    /// The model asked for: the setting, trimmed, or the provider's default.
    #[must_use]
    pub fn effective_model(&self) -> String {
        let trimmed = self.model.trim();
        if trimmed.is_empty() {
            self.provider.default_model().to_owned()
        } else {
            trimmed.to_owned()
        }
    }
}

fn clip(value: &mut String, max: usize) {
    if value.chars().count() > max {
        *value = value.chars().take(max).collect();
    }
}
