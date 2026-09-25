//! The module's settings namespace, `settings.modules.bluetooth` (docs/modules/bluetooth.md).
//! A missing or malformed entry yields the defaults instead of failing the whole document, and
//! unknown keys are ignored so an older build can read a newer file (docs/03-architecture.md).

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct BluetoothSettings {
    /// Announce a connected device's battery at 20 % and again at 10 %.
    pub low_battery_notices: bool,
    /// Devices (by id) the panel leaves out; the settings pane still lists them so they can
    /// be shown again.
    pub hidden_devices: Vec<String>,
}

impl Default for BluetoothSettings {
    fn default() -> Self {
        Self {
            low_battery_notices: true,
            hidden_devices: Vec::new(),
        }
    }
}

impl BluetoothSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "bluetooth settings malformed; using defaults");
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
    pub fn is_hidden(&self, id: &str) -> bool {
        self.hidden_devices.iter().any(|hidden| hidden == id)
    }
}
