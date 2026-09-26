//! The module's settings namespace, `settings.modules.calendar` (docs/modules/calendar.md).
//! Sources here carry everything the UI shows — a name, a colour, the feed's host — and never
//! the feed address itself: a private ICS link is a bearer secret, so it lives in the
//! Credential Manager under [`secret_key`] and `settings.json` can be exported freely.
//!
//! A missing or malformed entry yields the defaults instead of failing the whole document,
//! and unknown keys are ignored so an older build can read a newer file.

use muna_core::{Settings, Tint};
use serde::{Deserialize, Serialize};
use specta::Type;

/// The refresh periods the settings pane offers, in minutes.
pub const REFRESH_CHOICES_MINUTES: [u16; 4] = [5, 15, 30, 60];
/// The default period.
pub const DEFAULT_REFRESH_MINUTES: u16 = 5;
/// The longest a source name may be after trimming.
pub const MAX_NAME_CHARS: usize = 60;

/// The Credential Manager key an ICS source's address is kept under.
#[must_use]
pub fn secret_key(source_id: &str) -> String {
    format!("calendar:ics:{source_id}")
}

/// One subscribed calendar, as the settings document and the UI see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceSetting {
    /// Stable, opaque; also names the secret and the cache entry.
    pub id: String,
    pub name: String,
    pub color: Tint,
    /// A disabled source keeps its address and cache but is neither fetched nor shown.
    pub enabled: bool,
    /// The feed's host, so the settings pane can say where it comes from without the address.
    pub host: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarSettings {
    pub sources: Vec<SourceSetting>,
    /// One of [`REFRESH_CHOICES_MINUTES`].
    pub refresh_minutes: u16,
    /// Whether the next event within the hour takes the strip.
    pub show_next_in_strip: bool,
    /// Whether an event is announced ten minutes before it starts.
    pub notices: bool,
}

impl Default for CalendarSettings {
    fn default() -> Self {
        Self {
            sources: Vec::new(),
            refresh_minutes: DEFAULT_REFRESH_MINUTES,
            show_next_in_strip: true,
            notices: true,
        }
    }
}

impl CalendarSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document and repairs what a hand-edited file may
    /// have broken: an unknown refresh period falls back to the default, blank names become
    /// the host, blank or duplicate ids drop the source.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        let mut parsed = serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "calendar settings malformed; using defaults");
            Self::default()
        });
        parsed.repair();
        parsed
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// The refresh period as a duration.
    #[must_use]
    pub fn refresh(&self) -> std::time::Duration {
        std::time::Duration::from_secs(u64::from(self.refresh_minutes) * 60)
    }

    /// The source with `id`, if any.
    #[must_use]
    pub fn source(&self, id: &str) -> Option<&SourceSetting> {
        self.sources.iter().find(|source| source.id == id)
    }

    fn repair(&mut self) {
        if !REFRESH_CHOICES_MINUTES.contains(&self.refresh_minutes) {
            tracing::warn!(
                minutes = self.refresh_minutes,
                "calendar refresh period not offered; using the default"
            );
            self.refresh_minutes = DEFAULT_REFRESH_MINUTES;
        }
        let mut seen = std::collections::BTreeSet::new();
        self.sources.retain(|source| {
            let id = source.id.trim();
            !id.is_empty() && id == source.id && seen.insert(source.id.clone())
        });
        for source in &mut self.sources {
            let name = trim_name(&source.name);
            source.name = if name.is_empty() {
                source.host.clone()
            } else {
                name
            };
        }
    }
}

/// A source name as it is kept: trimmed and cut at [`MAX_NAME_CHARS`].
#[must_use]
pub fn trim_name(name: &str) -> String {
    name.trim().chars().take(MAX_NAME_CHARS).collect()
}
