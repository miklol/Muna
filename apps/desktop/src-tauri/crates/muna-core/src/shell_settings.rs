//! Notch shell settings (docs/modules/notch-shell.md, "Settings"): what the shell needs to
//! place a notch window on each monitor. Per-monitor entries are keyed by the monitor's stable
//! id; a monitor without an entry uses [`ShellSettings::defaults`], so a freshly attached
//! display gets a notch without any setup.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

/// Overlay draws over other windows and yields; Reserved registers an `AppBar` of strip height
/// so maximised windows start below the strip (ADR-0002 consequences).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum PlacementMode {
    #[default]
    Overlay,
    Reserved,
}

/// Notch (flush with the top edge, flared) or Island (floating capsule); see
/// docs/05-design-system.md "Shape".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum NotchShape {
    #[default]
    Notch,
    Island,
}

/// Strip height presets: 32 (Default) · 26 (Compact) · 38 (Comfortable) CSS px.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum StripHeight {
    Compact,
    #[default]
    Default,
    Comfortable,
}

impl StripHeight {
    /// Strip height in CSS pixels.
    #[must_use]
    pub const fn css_px(self) -> u32 {
        match self {
            Self::Compact => 26,
            Self::Default => 32,
            Self::Comfortable => 38,
        }
    }
}

/// Everything the shell needs for one monitor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonitorLayout {
    /// `false` removes the notch from this monitor: its window is parked off-screen and the
    /// UI pauses, so re-enabling is instant.
    pub enabled: bool,
    pub mode: PlacementMode,
    pub shape: NotchShape,
    /// Horizontal offset from the monitor centre, CSS px (positive = right).
    pub offset_x: i32,
    /// Vertical offset from the top edge, CSS px. Island adds its own 6–8 px on top.
    pub offset_y: i32,
    pub strip_height: StripHeight,
}

impl Default for MonitorLayout {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: PlacementMode::Overlay,
            shape: NotchShape::Notch,
            offset_x: 0,
            offset_y: 0,
            strip_height: StripHeight::Default,
        }
    }
}

/// Global shell settings plus the per-monitor table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellSettings {
    /// `WDA_EXCLUDEFROMCAPTURE` on every notch window.
    pub hide_from_captures: bool,
    /// Global shortcut that expands or collapses the notch under the cursor
    /// (`tauri-plugin-global-shortcut` syntax).
    pub toggle_hotkey: String,
    /// Layout used for monitors without an entry in `monitors`.
    pub defaults: MonitorLayout,
    /// Per-monitor overrides keyed by the stable monitor id (`\\.\DISPLAY1`, …).
    pub monitors: BTreeMap<String, MonitorLayout>,
}

impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            hide_from_captures: false,
            toggle_hotkey: "ctrl+alt+space".into(),
            defaults: MonitorLayout::default(),
            monitors: BTreeMap::new(),
        }
    }
}

impl ShellSettings {
    /// Layout for a monitor: its own entry, or the defaults.
    #[must_use]
    pub fn layout_for(&self, monitor_id: &str) -> &MonitorLayout {
        self.monitors.get(monitor_id).unwrap_or(&self.defaults)
    }

    /// Mutable layout for a monitor, creating its entry from the defaults on first use.
    pub fn layout_for_mut(&mut self, monitor_id: &str) -> &mut MonitorLayout {
        let defaults = self.defaults.clone();
        self.monitors
            .entry(monitor_id.to_owned())
            .or_insert(defaults)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn monitors_without_an_entry_use_the_defaults() {
        let mut settings = ShellSettings::default();
        settings.defaults.shape = NotchShape::Island;
        assert_eq!(
            settings.layout_for(r"\\.\DISPLAY9").shape,
            NotchShape::Island
        );
        settings.layout_for_mut(r"\\.\DISPLAY9").enabled = false;
        assert!(!settings.layout_for(r"\\.\DISPLAY9").enabled);
        assert_eq!(
            settings.layout_for(r"\\.\DISPLAY9").shape,
            NotchShape::Island,
            "the new entry starts from the defaults"
        );
        assert!(settings.layout_for(r"\\.\DISPLAY1").enabled);
    }

    #[test]
    fn strip_heights_match_the_spec() {
        assert_eq!(StripHeight::Compact.css_px(), 26);
        assert_eq!(StripHeight::Default.css_px(), 32);
        assert_eq!(StripHeight::Comfortable.css_px(), 38);
    }

    #[test]
    fn serialises_with_camel_case_and_lower_case_enums() {
        let json = serde_json::to_value(ShellSettings::default()).unwrap();
        assert_eq!(json["toggleHotkey"], "ctrl+alt+space");
        assert_eq!(json["defaults"]["mode"], "overlay");
        assert_eq!(json["defaults"]["stripHeight"], "default");
        assert_eq!(json["hideFromCaptures"], false);
    }
}
