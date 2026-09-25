//! The module's settings namespace, `settings.modules.weather` (docs/modules/weather.md).
//! Off by default: the module makes no request until the user turns it on
//! (`.github/copilot-instructions.md`, "no network calls without an explicit user-enabled
//! integration"). A missing or malformed entry yields the defaults instead of failing the
//! whole document, and unknown keys are ignored so an older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::provider::Place;

/// How temperatures and wind speeds read; the forecast itself is always metric.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Units {
    /// °C and km/h.
    #[default]
    Metric,
    /// °F and mph.
    Imperial,
}

/// Where the forecast is for.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LocationSetting {
    /// Windows Geolocation, asked once per launch and again on "Try again"; a denial leaves
    /// the module at "Choose a city" without asking again.
    #[default]
    Auto,
    /// A place picked from the geocoder.
    Manual { place: Place },
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct WeatherSettings {
    /// Whether the module fetches at all. Off until the user turns it on.
    pub enabled: bool,
    pub units: Units,
    pub location: LocationSetting,
}

impl WeatherSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document. A manual place whose coordinates are off
    /// the globe (a hand-edited file) falls back to the automatic location.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        let mut parsed = serde_json::from_value::<Self>(value.clone()).unwrap_or_else(|error| {
            tracing::warn!(%error, "weather settings malformed; using defaults");
            Self::default()
        });
        if let LocationSetting::Manual { place } = &parsed.location
            && !place.is_valid()
        {
            tracing::warn!("weather place has invalid coordinates; using the device location");
            parsed.location = LocationSetting::Auto;
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
}
