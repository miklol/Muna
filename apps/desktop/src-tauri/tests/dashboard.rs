//! The `dashboard` module's settings namespace and registration (docs/modules/dashboard.md,
//! docs/build-plan/m3-daily-modules.md E9). The grid itself is frontend-only; Rust keeps the
//! persisted layout well-formed. Integration tests because the `muna` lib cannot host unit
//! tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;

use muna_core::{Clock, FakeClock, Hub, Settings};
use muna_lib::modules::dashboard::{
    DashboardModule, DashboardSettings, DashboardSlot, ID,
    settings::{GRID_CELLS, GRID_COLUMNS, GRID_ROWS, MAX_SPAN},
};
use muna_lib::modules::{ModuleBackend, ModuleCtx, ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform};

#[test]
fn the_default_layout_fills_exactly_one_grid_with_every_p1_widget() {
    let settings = DashboardSettings::default();
    assert_eq!(GRID_CELLS, GRID_COLUMNS * GRID_ROWS);
    assert_eq!(settings.used_cells(), GRID_CELLS);
    assert_eq!(
        settings.clone().clamped(),
        settings,
        "the defaults need no repair"
    );
    let ids: Vec<&str> = settings
        .slots
        .iter()
        .map(|slot| slot.module_id.as_str())
        .collect();
    assert_eq!(
        ids,
        [
            "media",
            "pomodoro",
            "todo",
            "weather",
            "day-progress",
            "system-monitor",
            "bluetooth"
        ]
    );
    assert_eq!(settings.slots[0].span, 2, "media is wide by default");
}

#[test]
fn a_missing_or_malformed_namespace_reads_as_the_defaults() {
    let mut document = Settings::default();
    assert_eq!(
        DashboardSettings::from_document(&document),
        DashboardSettings::default()
    );

    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "slots": [{ "moduleId": "todo", "span": "two" }] }),
    );
    assert_eq!(
        DashboardSettings::from_document(&document),
        DashboardSettings::default(),
        "a wrong type fails the whole entry"
    );

    document
        .modules
        .insert(ID.to_owned(), serde_json::json!({ "profile": "work" }));
    assert_eq!(
        DashboardSettings::from_document(&document),
        DashboardSettings::default(),
        "unknown keys are ignored and a missing `slots` is the default layout"
    );
}

#[test]
fn the_layout_is_repaired_the_way_the_ui_repairs_it() {
    let mut document = Settings::default();
    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "slots": [
            { "moduleId": "todo", "span": 2 },
            { "moduleId": "todo", "span": 1 },
            { "moduleId": "", "span": 1 },
            { "moduleId": "weather", "span": 9 },
            { "moduleId": "media", "span": 0 },
            { "moduleId": "pomodoro", "span": 2 },
            { "moduleId": "bluetooth", "span": 2 },
            { "moduleId": "system-monitor", "span": 1 },
        ] }),
    );
    let repaired = DashboardSettings::from_document(&document);
    assert_eq!(
        repaired.slots,
        [
            DashboardSlot::new("todo", 2),
            DashboardSlot::new("weather", MAX_SPAN),
            DashboardSlot::new("media", 1),
            DashboardSlot::new("pomodoro", 2),
            DashboardSlot::new("system-monitor", 1),
        ],
        "repeats and empty ids are dropped, spans clamp to 1..=2, and a slot that does not fit \
         is skipped while a narrower one after it still gets in"
    );
    assert_eq!(repaired.used_cells(), GRID_CELLS);

    document
        .modules
        .insert(ID.to_owned(), serde_json::json!({ "slots": [] }));
    assert!(
        DashboardSettings::from_document(&document).slots.is_empty(),
        "an emptied grid is a choice, not a fault"
    );
}

#[test]
fn the_namespace_round_trips_through_the_document() {
    let layout = DashboardSettings {
        slots: vec![
            DashboardSlot::new("weather", 1),
            DashboardSlot::new("media", 2),
        ],
    };
    let mut document = Settings::default();
    layout.write(&mut document).expect("serialises");
    assert_eq!(
        document.modules[ID],
        serde_json::json!({ "slots": [
            { "moduleId": "weather", "span": 1 },
            { "moduleId": "media", "span": 2 },
        ] }),
        "camelCase on the wire, like every other namespace"
    );
    assert_eq!(DashboardSettings::from_document(&document), layout);
}

#[test]
fn the_module_is_registered_with_a_panel_and_starts_without_doing_anything() {
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
        .expect("dashboard is registered");
    assert_eq!(backend.capabilities(), [Surface::Panel]);

    let ctx = ModuleCtx {
        platform: Arc::clone(&platform),
        activities: Arc::clone(&hub),
    };
    DashboardModule.start(ctx).expect("nothing to start");
    assert_eq!(DashboardSettings::KEY, ID);
}
