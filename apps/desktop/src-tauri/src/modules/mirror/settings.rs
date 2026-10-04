//! The module's settings namespace, `settings.modules.mirror` (docs/modules/mirror.md): the
//! opt-in that unlocks the camera, the horizontal flip, and the chosen camera. A missing or
//! malformed entry yields the defaults instead of failing the whole document, and unknown keys
//! are ignored so an older build can read a newer file.

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Longest camera id kept; Chromium's per-origin ids are 64 hex characters.
pub const DEVICE_ID_MAX: usize = 256;
/// Longest camera label kept (`MediaDeviceInfo.label`).
pub const DEVICE_LABEL_MAX: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct MirrorSettings {
    /// The only switch that lets the app's pages open a camera. Off by default; the OS camera
    /// indicator is the proof either way.
    pub enabled: bool,
    /// Show the preview as a mirror (the default, what people expect of a mirror).
    pub flip: bool,
    /// `MediaDeviceInfo.deviceId` of the chosen camera; `None` picks the system default.
    pub device_id: Option<String>,
    /// `MediaDeviceInfo.label` captured when the camera was chosen, so the settings pane can
    /// name it without opening it.
    pub device_label: Option<String>,
}

impl Default for MirrorSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            flip: true,
            device_id: None,
            device_label: None,
        }
    }
}

impl MirrorSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "mirror settings malformed; using defaults");
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

    /// Trims the device fields and drops empty or oversized ones; a label without an id names
    /// nothing, so it goes too.
    #[must_use]
    pub fn clamped(self) -> Self {
        let device_id = self.device_id.and_then(|id| bounded(&id, DEVICE_ID_MAX));
        let device_label = device_id
            .as_ref()
            .and(self.device_label)
            .and_then(|label| bounded(&label, DEVICE_LABEL_MAX));
        Self {
            device_id,
            device_label,
            ..self
        }
    }
}

fn bounded(value: &str, max: usize) -> Option<String> {
    let value = value.trim();
    (!value.is_empty() && value.chars().count() <= max).then(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_keep_the_camera_off_and_the_image_mirrored() {
        let settings = MirrorSettings::from_document(&Settings::default());
        assert!(!settings.enabled);
        assert!(settings.flip);
        assert_eq!(settings.device_id, None);
        assert_eq!(settings.device_label, None);
    }

    #[test]
    fn round_trips_through_the_document() {
        let mut document = Settings::default();
        let settings = MirrorSettings {
            enabled: true,
            flip: false,
            device_id: Some("abc123".to_owned()),
            device_label: Some("Front camera".to_owned()),
        };
        settings.write(&mut document).unwrap();
        assert_eq!(MirrorSettings::from_document(&document), settings);
    }

    #[test]
    fn malformed_and_unknown_fields_fall_back() {
        let mut document = Settings::default();
        document
            .modules
            .insert("mirror".to_owned(), serde_json::json!({ "enabled": "yes" }));
        assert_eq!(
            MirrorSettings::from_document(&document),
            MirrorSettings::default()
        );
        document.modules.insert(
            "mirror".to_owned(),
            serde_json::json!({ "enabled": true, "future": 1 }),
        );
        assert!(MirrorSettings::from_document(&document).enabled);
    }

    #[test]
    fn device_fields_are_trimmed_bounded_and_paired() {
        let clamped = MirrorSettings {
            device_id: Some("  cam-1  ".to_owned()),
            device_label: Some("  ".to_owned()),
            ..MirrorSettings::default()
        }
        .clamped();
        assert_eq!(clamped.device_id.as_deref(), Some("cam-1"));
        assert_eq!(clamped.device_label, None);

        let too_long = MirrorSettings {
            device_id: Some("x".repeat(DEVICE_ID_MAX + 1)),
            device_label: Some("Camera".to_owned()),
            ..MirrorSettings::default()
        }
        .clamped();
        assert_eq!(too_long.device_id, None);
        assert_eq!(
            too_long.device_label, None,
            "a label without an id names nothing"
        );

        let long_label = MirrorSettings {
            device_id: Some("cam".to_owned()),
            device_label: Some("y".repeat(DEVICE_LABEL_MAX + 1)),
            ..MirrorSettings::default()
        }
        .clamped();
        assert_eq!(long_label.device_id.as_deref(), Some("cam"));
        assert_eq!(long_label.device_label, None);
    }
}
