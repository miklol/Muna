//! The `keyboard-shortcuts` module (docs/modules/keyboard-shortcuts.md, M4-E6): the settings
//! namespace, the registrar diff, conflicts and presses, all against a scripted registrar in
//! place of `tauri-plugin-global-shortcut`. Integration tests because the `muna` lib cannot
//! host unit tests (Common Controls manifest on Tauri-linked tests).

use std::collections::BTreeSet;
use std::sync::Arc;

use muna_core::settings::{KEYBOARD_SHORTCUTS_KEY, TOGGLE_PANEL_ACTION};
use muna_core::{Clock, FakeClock, Hub, Settings};
use muna_lib::modules::keyboard_shortcuts::{
    HotkeyBinding, HotkeyError, HotkeyRegistrar, HotkeyService, HotkeySink, HotkeyState, ID,
    KeyboardShortcutsSettings, RegisterError, SNOOZE_MINUTES, actions, normalise_chord,
};
use muna_lib::modules::{ModuleCtx, ModuleServices, backends};
use muna_platform::{FakePlatform, Platform};
use parking_lot::Mutex;

/// A registrar that "holds" chords the way the OS does and refuses the ones another app owns.
#[derive(Debug, Default)]
struct ScriptedRegistrar {
    held: Mutex<BTreeSet<String>>,
    foreign: Mutex<BTreeSet<String>>,
    calls: Mutex<Vec<String>>,
}

impl ScriptedRegistrar {
    fn holding(&self) -> Vec<String> {
        self.held.lock().iter().cloned().collect()
    }

    fn calls(&self) -> Vec<String> {
        self.calls.lock().clone()
    }

    fn foreign_owns(&self, chord: &str) {
        self.foreign.lock().insert(chord.to_owned());
    }
}

impl HotkeyRegistrar for ScriptedRegistrar {
    fn register(&self, chord: &str) -> Result<(), RegisterError> {
        self.calls.lock().push(format!("register {chord}"));
        if !chord.contains('+') || chord.ends_with('+') {
            return Err(RegisterError::Invalid);
        }
        if self.foreign.lock().contains(chord) || !self.held.lock().insert(chord.to_owned()) {
            return Err(RegisterError::InUse);
        }
        Ok(())
    }

    fn unregister(&self, chord: &str) {
        self.calls.lock().push(format!("unregister {chord}"));
        self.held.lock().remove(chord);
    }
}

#[derive(Debug, Default)]
struct RecordingSink {
    presses: Mutex<Vec<(String, bool, u32)>>,
}

impl HotkeySink for RecordingSink {
    fn pressed(&self, action: &str, settings: &KeyboardShortcutsSettings) {
        self.presses.lock().push((
            action.to_owned(),
            settings.only_while_hovering,
            settings.snooze_minutes,
        ));
    }
}

fn service() -> (
    Arc<HotkeyService>,
    Arc<ScriptedRegistrar>,
    Arc<RecordingSink>,
) {
    let service = Arc::new(HotkeyService::new());
    let registrar = Arc::new(ScriptedRegistrar::default());
    let sink = Arc::new(RecordingSink::default());
    service.set_registrar(Arc::clone(&registrar) as Arc<dyn HotkeyRegistrar>);
    service.set_sink(Arc::clone(&sink) as Arc<dyn HotkeySink>);
    (service, registrar, sink)
}

fn document(namespace: serde_json::Value) -> Settings {
    let mut settings = Settings::default();
    settings
        .modules
        .insert(KEYBOARD_SHORTCUTS_KEY.to_owned(), namespace);
    settings
}

fn state_of(bindings: &[HotkeyBinding], action: &str) -> Option<(String, HotkeyState)> {
    bindings
        .iter()
        .find(|b| b.action == action)
        .map(|b| (b.chord.clone().unwrap_or_default(), b.state))
}

#[test]
fn the_defaults_are_the_three_shell_shortcuts_the_spec_names() {
    let defaults = KeyboardShortcutsSettings::default();
    assert_eq!(
        defaults.chord(actions::TOGGLE_PANEL),
        Some("ctrl+alt+space")
    );
    assert_eq!(defaults.chord(actions::PALETTE), Some("ctrl+shift+space"));
    assert_eq!(defaults.chord(actions::SNOOZE), Some("ctrl+alt+n"));
    assert_eq!(defaults.bindings.len(), 3, "module actions start unbound");
    assert!(!defaults.only_while_hovering);
    assert_eq!(defaults.snooze_minutes, SNOOZE_MINUTES[0]);
    assert_eq!(KeyboardShortcutsSettings::KEY, ID);
    assert_eq!(KeyboardShortcutsSettings::KEY, KEYBOARD_SHORTCUTS_KEY);
    assert_eq!(actions::TOGGLE_PANEL, TOGGLE_PANEL_ACTION);
}

#[test]
fn a_missing_or_malformed_namespace_reads_as_the_defaults() {
    assert_eq!(
        KeyboardShortcutsSettings::from_document(&Settings::default()),
        KeyboardShortcutsSettings::default()
    );
    let malformed = document(serde_json::json!({ "bindings": ["ctrl+alt+space"] }));
    assert_eq!(
        KeyboardShortcutsSettings::from_document(&malformed),
        KeyboardShortcutsSettings::default()
    );
    let partial = document(serde_json::json!({ "onlyWhileHovering": true, "unknown": 1 }));
    let read = KeyboardShortcutsSettings::from_document(&partial);
    assert!(read.only_while_hovering);
    assert_eq!(
        read.bindings,
        KeyboardShortcutsSettings::default().bindings,
        "a namespace without `bindings` keeps the defaults"
    );
}

#[test]
fn the_namespace_is_normalised_on_read() {
    let messy = document(serde_json::json!({
        "bindings": {
            "shell.togglePanel": " Ctrl + Alt + Space ",
            "todo.quickAdd": "",
            "  ": "ctrl+x",
            "pomodoro.toggle": "CTRL+SHIFT+P"
        },
        "snoozeMinutes": 7
    }));
    let read = KeyboardShortcutsSettings::from_document(&messy);
    assert_eq!(read.chord("shell.togglePanel"), Some("ctrl+alt+space"));
    assert_eq!(read.chord("pomodoro.toggle"), Some("ctrl+shift+p"));
    assert_eq!(
        read.bindings.len(),
        2,
        "empty chords and empty ids are dropped"
    );
    assert_eq!(
        read.snooze_minutes, SNOOZE_MINUTES[0],
        "snapped to an offered length"
    );
    assert_eq!(normalise_chord("Ctrl+ Alt +N"), "ctrl+alt+n");
    assert_eq!(normalise_chord("+"), "");
}

#[test]
fn the_namespace_round_trips_through_the_document() {
    let mut namespace = KeyboardShortcutsSettings::default();
    namespace
        .bindings
        .insert("todo.quickAdd".into(), "ctrl+alt+t".into());
    namespace.only_while_hovering = true;
    namespace.snooze_minutes = 60;
    let mut settings = Settings::default();
    namespace.write(&mut settings).expect("serialises");
    assert_eq!(
        KeyboardShortcutsSettings::from_document(&settings),
        namespace
    );
    let json = &settings.modules[KEYBOARD_SHORTCUTS_KEY];
    assert_eq!(json["onlyWhileHovering"], true);
    assert_eq!(json["snoozeMinutes"], 60);
    assert_eq!(json["bindings"]["todo.quickAdd"], "ctrl+alt+t");
}

#[test]
fn applying_the_defaults_registers_the_three_chords_and_reports_them() {
    let (service, registrar, _) = service();
    let bindings = service.apply_settings(&Settings::default());
    assert_eq!(bindings.len(), 3);
    assert!(
        bindings.iter().all(|b| b.state == HotkeyState::Registered),
        "{bindings:?}"
    );
    assert_eq!(
        registrar.holding(),
        ["ctrl+alt+n", "ctrl+alt+space", "ctrl+shift+space"]
    );
    assert_eq!(service.bindings(), bindings);
}

#[test]
fn re_applying_the_same_document_touches_nothing() {
    let (service, registrar, _) = service();
    service.apply_settings(&Settings::default());
    let before = registrar.calls().len();
    service.apply_settings(&Settings::default());
    assert_eq!(
        registrar.calls().len(),
        before,
        "no register or unregister call"
    );
}

#[test]
fn a_changed_document_unregisters_the_old_chord_and_registers_the_new_one() {
    let (service, registrar, _) = service();
    service.apply_settings(&Settings::default());
    let changed = document(serde_json::json!({
        "bindings": {
            "shell.togglePanel": "alt+f1",
            "todo.quickAdd": "ctrl+alt+t"
        }
    }));
    let bindings = service.apply_settings(&changed);
    assert_eq!(
        state_of(&bindings, actions::TOGGLE_PANEL),
        Some(("alt+f1".into(), HotkeyState::Registered))
    );
    assert_eq!(
        state_of(&bindings, "todo.quickAdd"),
        Some(("ctrl+alt+t".into(), HotkeyState::Registered))
    );
    assert!(
        state_of(&bindings, actions::PALETTE).is_none(),
        "an action missing from the document is unbound"
    );
    assert_eq!(registrar.holding(), ["alt+f1", "ctrl+alt+t"]);
    let calls = registrar.calls();
    assert!(calls.contains(&"unregister ctrl+alt+space".to_string()));
    assert!(calls.contains(&"unregister ctrl+shift+space".to_string()));
    assert!(calls.contains(&"unregister ctrl+alt+n".to_string()));
}

#[test]
fn a_chord_another_app_holds_stays_in_the_file_as_in_use() {
    let (service, registrar, _) = service();
    registrar.foreign_owns("ctrl+alt+space");
    let bindings = service.apply_settings(&Settings::default());
    assert_eq!(
        state_of(&bindings, actions::TOGGLE_PANEL),
        Some(("ctrl+alt+space".into(), HotkeyState::InUse))
    );
    assert_eq!(
        state_of(&bindings, actions::PALETTE),
        Some(("ctrl+shift+space".into(), HotkeyState::Registered))
    );
    assert_eq!(
        service.settings().chord(actions::TOGGLE_PANEL),
        Some("ctrl+alt+space"),
        "the binding is kept so the pane can show the conflict and a later launch can retry"
    );
}

#[test]
fn a_chord_the_plugin_cannot_parse_reads_as_invalid() {
    let (service, _, _) = service();
    let doc = document(serde_json::json!({ "bindings": { "shell.togglePanel": "space" } }));
    let bindings = service.apply_settings(&doc);
    assert_eq!(
        state_of(&bindings, actions::TOGGLE_PANEL),
        Some(("space".into(), HotkeyState::Invalid))
    );
}

#[test]
fn two_actions_on_one_chord_leave_the_second_in_use() {
    let (service, registrar, _) = service();
    let doc = document(serde_json::json!({
        "bindings": { "a.first": "ctrl+alt+x", "b.second": "ctrl+alt+x" }
    }));
    let bindings = service.apply_settings(&doc);
    assert_eq!(
        state_of(&bindings, "a.first"),
        Some(("ctrl+alt+x".into(), HotkeyState::Registered))
    );
    assert_eq!(
        state_of(&bindings, "b.second"),
        Some(("ctrl+alt+x".into(), HotkeyState::InUse))
    );
    assert_eq!(registrar.holding(), ["ctrl+alt+x"]);
}

#[test]
fn try_bind_registers_first_and_records_the_binding_in_the_namespace() {
    let (service, registrar, _) = service();
    service.apply_settings(&Settings::default());
    let bindings = service
        .try_bind("todo.quickAdd", "Ctrl+Alt+T")
        .expect("free chord");
    assert_eq!(
        state_of(&bindings, "todo.quickAdd"),
        Some(("ctrl+alt+t".into(), HotkeyState::Registered))
    );
    assert_eq!(
        service.settings().chord("todo.quickAdd"),
        Some("ctrl+alt+t")
    );
    assert!(registrar.holding().contains(&"ctrl+alt+t".to_string()));

    // Persisting the namespace and re-applying finds nothing to do.
    let mut settings = Settings::default();
    service.settings().write(&mut settings).expect("serialises");
    let before = registrar.calls().len();
    service.apply_settings(&settings);
    assert_eq!(registrar.calls().len(), before);
}

#[test]
fn try_bind_refuses_a_chord_another_app_holds_and_keeps_the_previous_binding() {
    let (service, registrar, _) = service();
    service.apply_settings(&Settings::default());
    registrar.foreign_owns("ctrl+alt+m");
    let error = service
        .try_bind(actions::TOGGLE_PANEL, "ctrl+alt+m")
        .expect_err("held by another app");
    assert_eq!(error, HotkeyError::InUse);
    assert_eq!(
        state_of(&service.bindings(), actions::TOGGLE_PANEL),
        Some(("ctrl+alt+space".into(), HotkeyState::Registered)),
        "the old chord is registered again"
    );
    assert_eq!(
        service.settings().chord(actions::TOGGLE_PANEL),
        Some("ctrl+alt+space"),
        "nothing changed in the namespace"
    );
    assert!(registrar.holding().contains(&"ctrl+alt+space".to_string()));
}

#[test]
fn try_bind_names_the_action_that_already_has_the_chord() {
    let (service, _, _) = service();
    service.apply_settings(&Settings::default());
    let error = service
        .try_bind("todo.quickAdd", "ctrl+alt+space")
        .expect_err("taken by the toggle");
    assert_eq!(
        error,
        HotkeyError::Taken {
            action: actions::TOGGLE_PANEL.to_owned()
        }
    );
    assert!(state_of(&service.bindings(), "todo.quickAdd").is_none());
}

#[test]
fn try_bind_rejects_empty_ids_and_unparsable_chords() {
    let (service, _, _) = service();
    service.apply_settings(&Settings::default());
    assert_eq!(
        service.try_bind("", "ctrl+alt+t").expect_err("empty id"),
        HotkeyError::Invalid
    );
    assert_eq!(
        service
            .try_bind("todo.quickAdd", "  ")
            .expect_err("empty chord"),
        HotkeyError::Invalid
    );
    assert_eq!(
        service
            .try_bind("todo.quickAdd", "t")
            .expect_err("no modifier"),
        HotkeyError::Invalid
    );
    assert_eq!(service.bindings().len(), 3);
}

#[test]
fn unbind_releases_the_chord_and_forgets_the_binding() {
    let (service, registrar, _) = service();
    service.apply_settings(&Settings::default());
    let bindings = service.unbind(actions::SNOOZE);
    assert!(state_of(&bindings, actions::SNOOZE).is_none());
    assert_eq!(service.settings().chord(actions::SNOOZE), None);
    assert!(!registrar.holding().contains(&"ctrl+alt+n".to_string()));
    assert!(
        registrar
            .calls()
            .contains(&"unregister ctrl+alt+n".to_string())
    );
}

#[test]
fn a_press_resolves_to_its_action_and_reaches_the_sink_with_the_settings() {
    let (service, _, sink) = service();
    let doc = document(serde_json::json!({
        "bindings": { "shell.togglePanel": "ctrl+alt+space", "shell.snooze": "ctrl+alt+n" },
        "onlyWhileHovering": true,
        "snoozeMinutes": 30
    }));
    service.apply_settings(&doc);
    assert_eq!(
        service.pressed("Ctrl+Alt+Space"),
        Some(actions::TOGGLE_PANEL.to_owned())
    );
    assert_eq!(
        service.pressed("ctrl+alt+n"),
        Some(actions::SNOOZE.to_owned())
    );
    assert_eq!(
        service.pressed("ctrl+alt+z"),
        None,
        "unbound chords go nowhere"
    );
    assert_eq!(
        sink.presses.lock().clone(),
        [
            (actions::TOGGLE_PANEL.to_owned(), true, 30),
            (actions::SNOOZE.to_owned(), true, 30)
        ]
    );
}

#[test]
fn a_press_on_a_chord_the_os_refused_goes_nowhere() {
    let (service, registrar, sink) = service();
    registrar.foreign_owns("ctrl+alt+space");
    service.apply_settings(&Settings::default());
    assert_eq!(service.pressed("ctrl+alt+space"), None);
    assert!(sink.presses.lock().is_empty());
}

#[test]
fn without_a_registrar_nothing_claims_to_be_registered() {
    let service = HotkeyService::new();
    let bindings = service.apply_settings(&Settings::default());
    assert!(bindings.iter().all(|b| b.state == HotkeyState::InUse));
}

#[test]
fn the_module_is_registered_without_a_surface_and_starts_without_doing_anything() {
    let clock = Arc::new(FakeClock::new());
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(muna_core::Store::open_in_memory().expect("store"));
    let services = ModuleServices::new(
        &platform,
        &hub,
        None,
        &store,
        &(Arc::clone(&clock) as Arc<dyn Clock>),
    );
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("keyboard shortcuts are registered");
    assert!(
        backend.capabilities().is_empty(),
        "the palette is a shell surface, not a module panel"
    );
    let ctx = ModuleCtx {
        platform: Arc::clone(&platform),
        activities: Arc::clone(&hub),
    };
    backend.start(ctx).expect("nothing to start");
    assert!(
        services.keyboard_shortcuts.bindings().is_empty(),
        "nothing applied yet"
    );
}
