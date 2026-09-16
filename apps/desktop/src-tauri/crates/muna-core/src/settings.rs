//! Versioned JSON settings (docs/03-architecture.md "Storage").
//!
//! The file is `%LOCALAPPDATA%\Muna\settings.json`. Every file carries a `version`; loading an
//! older version runs the migration chain, and unknown newer versions are refused rather than
//! silently downgraded. Module settings live under `modules.<id>` as opaque JSON so modules
//! own their own shape (ADR-0004).

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;
use thiserror::Error;

use crate::shell_settings::ShellSettings;

pub const CURRENT_VERSION: u32 = 4;

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("settings file could not be read or written: {0}")]
    Io(#[from] io::Error),
    #[error("settings file is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("settings version {found} is newer than this build supports ({supported})")]
    Newer { found: u32, supported: u32 },
    #[error("settings file has no numeric `version` field")]
    MissingVersion,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum ReducedMotion {
    /// Follow the Windows "animation effects" setting (default).
    #[default]
    System,
    On,
    Off,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GeneralSettings {
    pub launch_at_login: bool,
    pub reduced_motion: ReducedMotion,
    /// Accent name from docs/05-design-system.md (`blue`, `purple`, …).
    pub accent: String,
    /// The welcome tour was finished or skipped; the settings window shows it until then (v4).
    pub onboarded: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            launch_at_login: false,
            reduced_motion: ReducedMotion::System,
            accent: "blue".into(),
            onboarded: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub version: u32,
    pub general: GeneralSettings,
    /// Notch placement per monitor and the global shell switches (v2).
    pub shell: ShellSettings,
    /// Per-module settings keyed by module id; each module validates its own namespace.
    #[specta(type = BTreeMap<String, JsonValue>)]
    pub modules: BTreeMap<String, Value>,
}

/// Export-only mirror of `serde_json::Value` for the generated TypeScript (`JsonValue`).
///
/// specta-typescript refuses `serde_json`'s 64-bit integer variants, so [`Settings::modules`]
/// declares this shape for TypeScript while the runtime keeps `serde_json::Value`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(untagged)]
pub enum JsonValue {
    // `()` (not a unit variant) so the exporter renders `null` instead of `"Null"`.
    Null(()),
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsonValue>),
    Object(BTreeMap<String, JsonValue>),
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            general: GeneralSettings::default(),
            shell: ShellSettings::default(),
            modules: BTreeMap::new(),
        }
    }
}

impl Settings {
    /// Parses JSON of any supported version, migrating forward as needed.
    pub fn from_json(text: &str) -> Result<Self, SettingsError> {
        let mut value: Value = serde_json::from_str(text)?;
        let version = value
            .get("version")
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or(SettingsError::MissingVersion)?;
        if version > CURRENT_VERSION {
            return Err(SettingsError::Newer {
                found: version,
                supported: CURRENT_VERSION,
            });
        }
        migrate(&mut value, version);
        Ok(serde_json::from_value(value)?)
    }

    pub fn to_json(&self) -> Result<String, SettingsError> {
        Ok(serde_json::to_string_pretty(self)?)
    }
}

/// Applies each migration step in order. Add a `1 => { … }` arm when bumping
/// `CURRENT_VERSION`; never edit an earlier arm.
fn migrate(value: &mut Value, from: u32) {
    let mut version = from;
    while version < CURRENT_VERSION {
        match version {
            // Version 0 never shipped; treat it like an empty file with defaults filled in.
            0 => {
                if let Some(object) = value.as_object_mut() {
                    object.entry("general").or_insert_with(|| {
                        serde_json::to_value(GeneralSettings::default()).unwrap_or_default()
                    });
                    object
                        .entry("modules")
                        .or_insert_with(|| Value::Object(serde_json::Map::default()));
                }
            }
            // v2 (M1-E1): the notch shell's placement settings. Files written by M0 builds
            // have no `shell` key; they get the defaults (one Overlay Notch per monitor).
            1 => {
                if let Some(object) = value.as_object_mut() {
                    object.entry("shell").or_insert_with(|| {
                        serde_json::to_value(ShellSettings::default()).unwrap_or_default()
                    });
                }
            }
            // v3 (M1-E3): module bar order and disabled modules live in `shell`.
            2 => {
                if let Some(shell) = value.get_mut("shell").and_then(Value::as_object_mut) {
                    shell
                        .entry("moduleOrder")
                        .or_insert_with(|| Value::Array(Vec::new()));
                    shell
                        .entry("disabledModules")
                        .or_insert_with(|| Value::Array(Vec::new()));
                }
            }
            // v4 (M1-E5): the welcome tour. A file that predates it belongs to someone who has
            // already set Muna up, so the tour is marked seen; new profiles start with `false`.
            3 => {
                if let Some(general) = value.get_mut("general").and_then(Value::as_object_mut) {
                    general
                        .entry("onboarded")
                        .or_insert_with(|| Value::Bool(true));
                }
            }
            _ => unreachable!("migration from version {version} is not defined"),
        }
        version += 1;
        if let Some(object) = value.as_object_mut() {
            object.insert("version".into(), Value::from(version));
        }
    }
}

/// Loads and saves the settings file atomically (write to a sibling temp file, then rename).
#[derive(Debug, Clone)]
pub struct SettingsStore {
    path: PathBuf,
}

impl SettingsStore {
    #[must_use]
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Returns defaults when the file does not exist yet.
    pub fn load(&self) -> Result<Settings, SettingsError> {
        match fs::read_to_string(&self.path) {
            Ok(text) => Settings::from_json(&text),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Settings::default()),
            Err(error) => Err(error.into()),
        }
    }

    pub fn save(&self, settings: &Settings) -> Result<(), SettingsError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, settings.to_json()?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_round_trip_through_json() {
        let settings = Settings::default();
        let json = settings.to_json().unwrap();
        assert_eq!(Settings::from_json(&json).unwrap(), settings);
    }

    #[test]
    fn module_namespaces_are_opaque_json() {
        let json = r#"{"version":2,"general":{"launchAtLogin":true,"reducedMotion":"on","accent":"purple"},"shell":{"hideFromCaptures":false,"toggleHotkey":"ctrl+alt+space","defaults":{"enabled":true,"mode":"overlay","shape":"notch","offsetX":0,"offsetY":0,"stripHeight":"default"},"monitors":{}},"modules":{"media":{"showArtwork":false}}}"#;
        let settings = Settings::from_json(json).unwrap();
        assert!(settings.general.launch_at_login);
        assert_eq!(settings.general.reduced_motion, ReducedMotion::On);
        assert_eq!(
            settings.modules["media"],
            serde_json::json!({ "showArtwork": false })
        );
    }

    #[test]
    fn version_zero_is_migrated_forward() {
        let settings = Settings::from_json(r#"{"version":0}"#).unwrap();
        assert_eq!(settings.version, CURRENT_VERSION);
        assert_eq!(settings.general, GeneralSettings::default());
        assert_eq!(settings.shell, ShellSettings::default());
    }

    #[test]
    fn version_one_files_gain_default_shell_settings_and_keep_the_rest() {
        let json = r#"{"version":1,"general":{"launchAtLogin":true,"reducedMotion":"off","accent":"orange"},"modules":{"media":{"showArtwork":false}}}"#;
        let settings = Settings::from_json(json).unwrap();
        assert_eq!(settings.version, CURRENT_VERSION);
        assert_eq!(settings.shell, ShellSettings::default());
        assert!(settings.general.launch_at_login);
        assert_eq!(settings.general.accent, "orange");
        assert_eq!(
            settings.modules["media"],
            serde_json::json!({ "showArtwork": false })
        );
    }

    #[test]
    fn version_two_files_gain_an_empty_module_bar_arrangement_and_keep_monitors() {
        let json = r#"{"version":2,"general":{"launchAtLogin":false,"reducedMotion":"system","accent":"blue"},"shell":{"hideFromCaptures":true,"toggleHotkey":"ctrl+alt+space","defaults":{"enabled":true,"mode":"overlay","shape":"island","offsetX":0,"offsetY":0,"stripHeight":"default"},"monitors":{"\\\\.\\DISPLAY2":{"enabled":false,"mode":"reserved","shape":"notch","offsetX":12,"offsetY":0,"stripHeight":"compact"}}},"modules":{}}"#;
        let settings = Settings::from_json(json).unwrap();
        assert_eq!(settings.version, CURRENT_VERSION);
        assert!(settings.shell.module_order.is_empty());
        assert!(settings.shell.disabled_modules.is_empty());
        assert!(settings.shell.hide_from_captures);
        assert_eq!(
            settings.shell.defaults.shape,
            crate::shell_settings::NotchShape::Island
        );
        assert!(!settings.shell.layout_for(r"\\.\DISPLAY2").enabled);
    }

    #[test]
    fn version_three_files_count_as_onboarded_and_keep_the_rest() {
        let json = r#"{"version":3,"general":{"launchAtLogin":true,"reducedMotion":"on","accent":"pink"},"shell":{"hideFromCaptures":false,"toggleHotkey":"ctrl+alt+space","defaults":{"enabled":true,"mode":"reserved","shape":"notch","offsetX":0,"offsetY":0,"stripHeight":"default"},"monitors":{},"moduleOrder":["bluetooth"],"disabledModules":["battery"]},"modules":{}}"#;
        let settings = Settings::from_json(json).unwrap();
        assert_eq!(settings.version, 4);
        assert!(settings.general.onboarded);
        assert!(settings.general.launch_at_login);
        assert_eq!(settings.general.accent, "pink");
        assert_eq!(settings.shell.module_order, vec!["bluetooth".to_string()]);
        assert_eq!(settings.shell.disabled_modules, vec!["battery".to_string()]);
        assert_eq!(
            settings.shell.defaults.mode,
            crate::shell_settings::PlacementMode::Reserved
        );
    }

    #[test]
    fn new_profiles_start_with_the_tour_pending() {
        assert!(!Settings::default().general.onboarded);
        assert!(!Settings::from_json(r#"{"version":0}"#)
            .unwrap()
            .general
            .onboarded);
    }

    #[test]
    fn per_monitor_layouts_round_trip() {
        let mut settings = Settings::default();
        {
            let layout = settings.shell.layout_for_mut(r"\\.\DISPLAY2");
            layout.mode = crate::shell_settings::PlacementMode::Reserved;
            layout.offset_x = -40;
        }
        let json = settings.to_json().unwrap();
        let parsed = Settings::from_json(&json).unwrap();
        assert_eq!(parsed, settings);
        assert_eq!(
            parsed.shell.layout_for(r"\\.\DISPLAY2").mode,
            crate::shell_settings::PlacementMode::Reserved
        );
    }

    #[test]
    fn newer_versions_are_refused() {
        let error = Settings::from_json(r#"{"version":99,"general":{}}"#).unwrap_err();
        assert!(matches!(
            error,
            SettingsError::Newer {
                found: 99,
                supported: CURRENT_VERSION
            }
        ));
    }

    #[test]
    fn missing_version_is_an_error() {
        assert!(matches!(
            Settings::from_json("{}").unwrap_err(),
            SettingsError::MissingVersion
        ));
    }

    #[test]
    fn unknown_general_fields_are_rejected() {
        let json = r#"{"version":2,"general":{"launchAtLogin":true,"reducedMotion":"on","accent":"blue","nope":1},"shell":{"hideFromCaptures":false,"toggleHotkey":"ctrl+alt+space","defaults":{"enabled":true,"mode":"overlay","shape":"notch","offsetX":0,"offsetY":0,"stripHeight":"default"},"monitors":{}},"modules":{}}"#;
        assert!(matches!(
            Settings::from_json(json).unwrap_err(),
            SettingsError::Json(_)
        ));
    }

    #[test]
    fn store_returns_defaults_when_missing_and_saves_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(dir.path().join("nested").join("settings.json"));
        assert_eq!(store.load().unwrap(), Settings::default());

        let mut settings = Settings::default();
        settings.general.accent = "orange".into();
        store.save(&settings).unwrap();

        assert_eq!(store.load().unwrap(), settings);
        assert!(!store.path().with_extension("json.tmp").exists());
    }
}
