//! The module's settings namespace, `settings.modules.notifications`
//! (docs/modules/notifications.md). A missing or malformed entry yields the defaults instead
//! of failing the whole document, and unknown keys are ignored so an older build can read a
//! newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationsSettings {
    /// Announce an arriving notification in the strip (held back while Windows says the user
    /// is busy or a focus session is on).
    pub arrival_notices: bool,
    /// Keep the unread glance (latest sender and count) in the strip while anything is unread.
    pub show_unread_in_strip: bool,
    /// Senders (by app user model id) whose notifications are listed but never announced or
    /// counted; the settings pane lists them so they can be unmuted.
    pub muted_apps: Vec<String>,
}

impl Default for NotificationsSettings {
    fn default() -> Self {
        Self {
            arrival_notices: true,
            show_unread_in_strip: true,
            muted_apps: Vec::new(),
        }
    }
}

impl NotificationsSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "notifications settings malformed; using defaults");
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

    #[must_use]
    pub fn is_muted(&self, app_id: &str) -> bool {
        self.muted_apps.iter().any(|muted| muted == app_id)
    }
}
