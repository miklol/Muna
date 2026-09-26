//! The module's settings namespace, `settings.modules.keyboard-shortcuts`
//! (docs/modules/keyboard-shortcuts.md). A missing or malformed entry yields the defaults
//! instead of failing the whole document, and unknown keys are ignored so an older build can
//! read a newer file (docs/03-architecture.md).
//!
//! `bindings` maps an action id (`shell.togglePanel`, `todo.quickAdd`, …) to a chord in
//! `tauri-plugin-global-shortcut` syntax (`ctrl+alt+space`). Rust does not know which actions
//! exist — the frontend registry owns them, like the dashboard's widget list — so it keeps the
//! map well-formed only: non-empty ids, trimmed lower-case chords, and an action bound to an
//! empty chord is simply unbound.

use std::collections::BTreeMap;

use muna_core::Settings;
use serde::{Deserialize, Serialize};
use specta::Type;

/// Snooze lengths the pane offers, in minutes (docs/modules/keyboard-shortcuts.md "Scope").
pub const SNOOZE_MINUTES: [u32; 3] = [15, 30, 60];

/// Actions the shell handles itself; every other id is forwarded to the UI as
/// `HotkeyPressed` and resolved against the module registry there.
pub mod actions {
    /// Expands or collapses the notch under the cursor.
    pub const TOGGLE_PANEL: &str = muna_core::settings::TOGGLE_PANEL_ACTION;
    /// Opens the panel on the command palette.
    pub const PALETTE: &str = "shell.palette";
    /// Parks the notch on the display under the cursor for `snooze_minutes`.
    pub const SNOOZE: &str = "shell.snooze";
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyboardShortcutsSettings {
    /// Action id → chord. An action missing here is unbound.
    pub bindings: BTreeMap<String, String>,
    /// Fire only while the cursor is over the notch (strip or panel).
    pub only_while_hovering: bool,
    /// How long `shell.snooze` parks the notch, one of [`SNOOZE_MINUTES`].
    pub snooze_minutes: u32,
}

impl Default for KeyboardShortcutsSettings {
    /// The three shell shortcuts the spec names; module actions start unbound.
    fn default() -> Self {
        Self {
            bindings: [
                (actions::TOGGLE_PANEL, "ctrl+alt+space"),
                (actions::PALETTE, "ctrl+shift+space"),
                (actions::SNOOZE, "ctrl+alt+n"),
            ]
            .into_iter()
            .map(|(action, chord)| (action.to_owned(), chord.to_owned()))
            .collect(),
            only_while_hovering: false,
            snooze_minutes: SNOOZE_MINUTES[0],
        }
    }
}

impl KeyboardShortcutsSettings {
    /// The key under `settings.modules`; also the module id.
    pub const KEY: &'static str = super::ID;

    /// Reads the namespace from a settings document, repaired to a valid map.
    #[must_use]
    pub fn from_document(settings: &Settings) -> Self {
        let Some(value) = settings.modules.get(Self::KEY) else {
            return Self::default();
        };
        serde_json::from_value::<Self>(value.clone())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "keyboard-shortcuts settings malformed; using defaults");
                Self::default()
            })
            .normalised()
    }

    /// Writes the namespace back into a settings document.
    pub fn write(&self, settings: &mut Settings) -> Result<(), serde_json::Error> {
        settings
            .modules
            .insert(Self::KEY.to_owned(), serde_json::to_value(self)?);
        Ok(())
    }

    /// Drops empty action ids and empty chords, trims and lower-cases the rest, and snaps the
    /// snooze length to one the pane offers.
    #[must_use]
    pub fn normalised(self) -> Self {
        let bindings = self
            .bindings
            .into_iter()
            .filter_map(|(action, chord)| {
                let action = action.trim();
                let chord = normalise_chord(&chord);
                (!action.is_empty() && !chord.is_empty()).then(|| (action.to_owned(), chord))
            })
            .collect();
        let snooze_minutes = if SNOOZE_MINUTES.contains(&self.snooze_minutes) {
            self.snooze_minutes
        } else {
            SNOOZE_MINUTES[0]
        };
        Self {
            bindings,
            only_while_hovering: self.only_while_hovering,
            snooze_minutes,
        }
    }

    /// The chord bound to `action`, if any.
    #[must_use]
    pub fn chord(&self, action: &str) -> Option<&str> {
        self.bindings.get(action).map(String::as_str)
    }
}

/// Chords compare case-insensitively and without stray spaces (`Ctrl + Alt + Space` and
/// `ctrl+alt+space` are the same binding).
#[must_use]
pub fn normalise_chord(chord: &str) -> String {
    chord
        .split('+')
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>()
        .join("+")
}
