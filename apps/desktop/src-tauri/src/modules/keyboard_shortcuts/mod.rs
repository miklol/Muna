//! Keyboard shortcuts module (docs/modules/keyboard-shortcuts.md): global hotkeys for the
//! shell's own actions and for actions the modules register on the frontend, plus the
//! settings namespace behind the *Keyboard shortcuts* pane and the command palette.
//!
//! The service is Tauri-free so it runs under `cargo test`: registering a chord with the OS
//! goes through a [`HotkeyRegistrar`] (the binary wires `tauri-plugin-global-shortcut`, tests
//! script a fake that refuses chords another app "holds"), and a press comes back through
//! [`HotkeyService::pressed`] and leaves through a [`HotkeySink`] (the binary emits
//! `HotkeyPressed` for the UI and parks the notch itself for `shell.snooze`).
//!
//! Registration follows the settings document: `apply_settings` diffs the wanted bindings
//! against the registered ones, so a chord the OS refuses stays in the file with an *in use*
//! state for the pane to show, and a later launch tries it again (the other app may be gone).

pub mod settings;

use std::collections::BTreeMap;
use std::sync::Arc;

use muna_core::Settings;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
pub use settings::{KeyboardShortcutsSettings, SNOOZE_MINUTES, actions, normalise_chord};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};

/// Module id and settings namespace.
pub const ID: &str = "keyboard-shortcuts";

/// Why the OS (or the syntax) refused a chord.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegisterError {
    /// Not a chord the plugin can parse (`ctrl+`, `space`, unknown key names).
    Invalid,
    /// `RegisterHotKey` failed: another application holds the chord.
    InUse,
}

/// Registers chords with the OS. One implementation per runtime; chords arrive normalised.
pub trait HotkeyRegistrar: Send + Sync {
    fn register(&self, chord: &str) -> Result<(), RegisterError>;
    fn unregister(&self, chord: &str);
}

/// Receives presses the service resolved to an action id.
pub trait HotkeySink: Send + Sync {
    /// `settings` is the namespace at the time of the press (the snooze length, the hover
    /// scope) so the sink needs no lock of its own.
    fn pressed(&self, action: &str, settings: &KeyboardShortcutsSettings);
}

/// What the pane shows beside each binding.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HotkeyState {
    /// Bound and registered with the OS.
    Registered,
    /// Bound in the settings, refused by the OS — another app holds the chord.
    InUse,
    /// Bound in the settings to a chord the plugin cannot parse.
    Invalid,
    /// No chord.
    Unbound,
}

/// One action's binding as the pane and the palette see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBinding {
    pub action: String,
    pub chord: Option<String>,
    pub state: HotkeyState,
}

/// Why `set_hotkey` refused a binding.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HotkeyError {
    #[error("the action id or chord is empty or not a chord")]
    Invalid,
    #[error("another application already uses this shortcut")]
    InUse,
    #[error("the shortcut is already bound to {action}")]
    Taken { action: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Registration {
    chord: String,
    state: HotkeyState,
}

#[derive(Debug, Default)]
struct Inner {
    settings: KeyboardShortcutsSettings,
    /// Action → chord and whether the OS took it. Only actions with a chord appear.
    registered: BTreeMap<String, Registration>,
}

/// The module object the IPC layer and the module backend share.
pub struct HotkeyService {
    registrar: Mutex<Option<Arc<dyn HotkeyRegistrar>>>,
    sink: Mutex<Option<Arc<dyn HotkeySink>>>,
    inner: Mutex<Inner>,
}

impl std::fmt::Debug for HotkeyService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("HotkeyService")
            .field("registered", &inner.registered.len())
            .field("only_while_hovering", &inner.settings.only_while_hovering)
            .finish_non_exhaustive()
    }
}

impl Default for HotkeyService {
    fn default() -> Self {
        Self::new()
    }
}

impl HotkeyService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            registrar: Mutex::new(None),
            sink: Mutex::new(None),
            inner: Mutex::new(Inner::default()),
        }
    }

    /// Attaches the runtime's registrar. Nothing registers before this; the binary sets it in
    /// `setup`, right before the first `apply_settings`.
    pub fn set_registrar(&self, registrar: Arc<dyn HotkeyRegistrar>) {
        *self.registrar.lock() = Some(registrar);
    }

    pub fn set_sink(&self, sink: Arc<dyn HotkeySink>) {
        *self.sink.lock() = Some(sink);
    }

    /// The namespace as last applied.
    #[must_use]
    pub fn settings(&self) -> KeyboardShortcutsSettings {
        self.inner.lock().settings.clone()
    }

    /// Reads the namespace from `settings` and brings the OS registrations in line with it:
    /// actions whose chord went away or changed are unregistered, new or changed chords are
    /// registered, untouched ones are left alone. Returns the bindings afterwards.
    pub fn apply_settings(&self, settings: &Settings) -> Vec<HotkeyBinding> {
        let wanted = KeyboardShortcutsSettings::from_document(settings);
        let registrar = self.registrar.lock().clone();
        let mut inner = self.inner.lock();

        let gone: Vec<String> = inner
            .registered
            .iter()
            .filter(|(action, registration)| {
                wanted.chord(action) != Some(registration.chord.as_str())
            })
            .map(|(action, _)| action.clone())
            .collect();
        for action in gone {
            if let Some(registration) = inner.registered.remove(&action)
                && registration.state == HotkeyState::Registered
                && let Some(registrar) = &registrar
            {
                registrar.unregister(&registration.chord);
            }
        }

        let unregistered: Vec<(String, String)> = wanted
            .bindings
            .iter()
            .filter(|(action, _)| !inner.registered.contains_key(*action))
            .map(|(action, chord)| (action.clone(), chord.clone()))
            .collect();
        for (action, chord) in unregistered {
            let state = register(registrar.as_deref(), &inner.registered, &chord);
            inner
                .registered
                .insert(action, Registration { chord, state });
        }

        inner.settings = wanted;
        bindings_of(&inner)
    }

    /// Every bound action with its state, for `get_hotkeys`.
    #[must_use]
    pub fn bindings(&self) -> Vec<HotkeyBinding> {
        bindings_of(&self.inner.lock())
    }

    /// Binds `action` to `chord` with the OS now, so the pane learns about a conflict before
    /// anything is saved. On success the in-memory namespace already holds the binding; the
    /// caller persists the document and the following `apply_settings` finds nothing to do.
    /// On failure the previous binding of `action`, if any, is back in place.
    pub fn try_bind(&self, action: &str, chord: &str) -> Result<Vec<HotkeyBinding>, HotkeyError> {
        let action = action.trim();
        let chord = normalise_chord(chord);
        if action.is_empty() || chord.is_empty() {
            return Err(HotkeyError::Invalid);
        }
        let registrar = self.registrar.lock().clone();
        let mut inner = self.inner.lock();

        if let Some((holder, _)) = inner.registered.iter().find(|(holder, registration)| {
            holder.as_str() != action
                && registration.chord == chord
                && registration.state != HotkeyState::Invalid
        }) {
            return Err(HotkeyError::Taken {
                action: holder.clone(),
            });
        }

        let previous = inner.registered.remove(action);
        if let Some(previous) = &previous
            && previous.state == HotkeyState::Registered
            && let Some(registrar) = &registrar
        {
            registrar.unregister(&previous.chord);
        }

        let state = register(registrar.as_deref(), &inner.registered, &chord);
        if state == HotkeyState::Registered {
            inner.registered.insert(
                action.to_owned(),
                Registration {
                    chord: chord.clone(),
                    state,
                },
            );
            inner.settings.bindings.insert(action.to_owned(), chord);
            return Ok(bindings_of(&inner));
        }

        if let Some(previous) = previous {
            let restored = register(registrar.as_deref(), &inner.registered, &previous.chord);
            inner.registered.insert(
                action.to_owned(),
                Registration {
                    chord: previous.chord,
                    state: restored,
                },
            );
        }
        Err(match state {
            HotkeyState::InUse => HotkeyError::InUse,
            _ => HotkeyError::Invalid,
        })
    }

    /// Removes the binding of `action` (OS registration and namespace). The caller persists.
    pub fn unbind(&self, action: &str) -> Vec<HotkeyBinding> {
        let registrar = self.registrar.lock().clone();
        let mut inner = self.inner.lock();
        if let Some(registration) = inner.registered.remove(action.trim())
            && registration.state == HotkeyState::Registered
            && let Some(registrar) = &registrar
        {
            registrar.unregister(&registration.chord);
        }
        inner.settings.bindings.remove(action.trim());
        bindings_of(&inner)
    }

    /// The OS reported `chord`: resolves it to its action and hands it to the sink. Returns
    /// the action so the runtime can log it.
    pub fn pressed(&self, chord: &str) -> Option<String> {
        let chord = normalise_chord(chord);
        let (action, settings) = {
            let inner = self.inner.lock();
            let action = inner
                .registered
                .iter()
                .find(|(_, registration)| {
                    registration.chord == chord && registration.state == HotkeyState::Registered
                })
                .map(|(action, _)| action.clone())?;
            (action, inner.settings.clone())
        };
        if let Some(sink) = self.sink.lock().clone() {
            sink.pressed(&action, &settings);
        }
        Some(action)
    }
}

/// Registers `chord` unless another of our own actions already holds it.
fn register(
    registrar: Option<&dyn HotkeyRegistrar>,
    registered: &BTreeMap<String, Registration>,
    chord: &str,
) -> HotkeyState {
    if registered
        .values()
        .any(|r| r.chord == chord && r.state == HotkeyState::Registered)
    {
        return HotkeyState::InUse;
    }
    match registrar {
        Some(registrar) => match registrar.register(chord) {
            Ok(()) => HotkeyState::Registered,
            Err(RegisterError::InUse) => HotkeyState::InUse,
            Err(RegisterError::Invalid) => HotkeyState::Invalid,
        },
        // No runtime attached (tests that never set one): the OS did not take the chord, and
        // *in use* is the reading that says so without claiming a registration.
        None => HotkeyState::InUse,
    }
}

fn bindings_of(inner: &Inner) -> Vec<HotkeyBinding> {
    inner
        .registered
        .iter()
        .map(|(action, registration)| HotkeyBinding {
            action: action.clone(),
            chord: Some(registration.chord.clone()),
            state: registration.state,
        })
        .collect()
}

/// The registry entry. Nothing to start: registrations follow `apply_settings`.
#[derive(Debug, Clone)]
pub struct KeyboardShortcutsModule(pub Arc<HotkeyService>);

impl ModuleBackend for KeyboardShortcutsModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
