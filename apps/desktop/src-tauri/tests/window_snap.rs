//! The `window-snap` module (docs/modules/window-snap.md, M4-E3): zone geometry on mixed-DPI
//! monitors, the settings namespace and its bounds, the session registry the shell writes,
//! and placement through the fake `WindowPlacement` — including the re-apply after a window
//! that would not stay put. Integration tests because the `muna` lib cannot host unit tests
//! (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;
use std::time::Duration;

use muna_core::{Clock, FakeClock, Hub, Settings, Store, SystemClock};
use muna_lib::modules::window_snap::zones::physical_gap;
use muna_lib::modules::window_snap::{
    ID, MAX_ZONES, Placement, SnapError, SnapGrid, SnapZone, SnapZoneRef, WindowSnapService,
    WindowSnapSettings, cell_frame, zone_placement,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, MonitorInfo, PlacementCall, Platform, PlatformError, Rect};

/// 2560 × 1440 at 100 %, taskbar at the bottom.
fn primary() -> MonitorInfo {
    MonitorInfo {
        id: r"\\.\DISPLAY1".to_owned(),
        bounds: Rect::new(0, 0, 2560, 1440),
        work_area: Rect::new(0, 0, 2560, 1400),
        dpi: 96,
        is_primary: true,
    }
}

/// 4K at 150 % to the right of the primary, taskbar at the bottom.
fn secondary() -> MonitorInfo {
    MonitorInfo {
        id: r"\\.\DISPLAY2".to_owned(),
        bounds: Rect::new(2560, 0, 3840, 2160),
        work_area: Rect::new(2560, 0, 3840, 2100),
        dpi: 144,
        is_primary: false,
    }
}

const WINDOW: isize = 0x1000;

struct Harness {
    platform: Arc<FakePlatform>,
    service: WindowSnapService,
}

fn harness() -> Harness {
    let platform = Arc::new(FakePlatform::new());
    platform.set_monitors(vec![primary(), secondary()]);
    platform.set_foreign_window(WINDOW, Rect::new(100, 100, 800, 600), true);
    let service = WindowSnapService::new(Arc::clone(&platform) as Arc<dyn Platform>)
        .with_verify_delay(Duration::ZERO);
    service.apply_settings(&Settings::default());
    Harness { platform, service }
}

impl Harness {
    fn set_settings(&self, settings: &WindowSnapSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).unwrap();
        self.service.apply_settings(&document);
    }

    fn begin(&self) -> u32 {
        let sessions = self.service.sessions();
        let id = sessions.begin(WINDOW);
        sessions.mark_ended(id);
        id
    }
}

fn frame(zone: SnapZone, work_area: Rect) -> Rect {
    match zone_placement(zone, work_area) {
        Placement::Frame(rect) => rect,
        Placement::Maximize => panic!("{zone:?} maximises"),
    }
}

// --- geometry -------------------------------------------------------------------------------

#[test]
fn halves_quarters_and_thirds_tile_the_work_area_exactly() {
    let work = primary().work_area;
    assert_eq!(frame(SnapZone::LeftHalf, work), Rect::new(0, 0, 1280, 1400));
    assert_eq!(
        frame(SnapZone::RightHalf, work),
        Rect::new(1280, 0, 1280, 1400)
    );
    assert_eq!(frame(SnapZone::TopLeft, work), Rect::new(0, 0, 1280, 700));
    assert_eq!(
        frame(SnapZone::BottomLeft, work),
        Rect::new(0, 700, 1280, 700)
    );
    assert_eq!(
        frame(SnapZone::TopRight, work),
        Rect::new(1280, 0, 1280, 700)
    );
    assert_eq!(
        frame(SnapZone::BottomRight, work),
        Rect::new(1280, 700, 1280, 700)
    );
    // 2560 / 3 = 853 r 1: the last third takes the remainder.
    assert_eq!(frame(SnapZone::LeftThird, work), Rect::new(0, 0, 853, 1400));
    assert_eq!(
        frame(SnapZone::CenterThird, work),
        Rect::new(853, 0, 853, 1400)
    );
    assert_eq!(
        frame(SnapZone::RightThird, work),
        Rect::new(1706, 0, 854, 1400)
    );
    assert_eq!(
        zone_placement(SnapZone::Maximize, work),
        Placement::Maximize
    );
}

#[test]
fn zones_follow_a_secondary_monitor_offset_and_its_work_area() {
    let work = Rect::new(2560, -400, 3840, 2100);
    assert_eq!(
        zone_placement(SnapZone::RightHalf, work),
        Placement::Frame(Rect::new(4480, -400, 1920, 2100))
    );
    assert_eq!(
        zone_placement(SnapZone::BottomLeft, work),
        Placement::Frame(Rect::new(2560, 650, 1920, 1050))
    );
}

#[test]
fn a_grid_cell_leaves_gutters_around_and_between_scaled_to_the_monitor() {
    let grid = SnapGrid {
        rows: 2,
        cols: 2,
        gap: 10,
    };
    let work = primary().work_area;
    // 100 %: gap 10 px; inner 2560 - 30 = 2530 → 1265 each; 1400 - 30 = 1370 → 685 each.
    assert_eq!(
        cell_frame(grid, 0, 0, work, 96),
        Some(Rect::new(10, 10, 1265, 685))
    );
    assert_eq!(
        cell_frame(grid, 1, 1, work, 96),
        Some(Rect::new(1285, 705, 1265, 685))
    );
    assert_eq!(cell_frame(grid, 2, 0, work, 96), None);
    assert_eq!(cell_frame(grid, 0, 2, work, 96), None);

    assert_eq!(physical_gap(10, 96), 10);
    assert_eq!(physical_gap(10, 144), 15);
    assert_eq!(physical_gap(10, 192), 20);
    assert_eq!(physical_gap(7, 144), 11);
    // 150 %: an 8 px gap is 12 px; inner 3840 - 48 = 3792 → 1264 each.
    let thirds = SnapGrid {
        rows: 1,
        cols: 3,
        gap: 8,
    };
    assert_eq!(
        cell_frame(thirds, 0, 2, Rect::new(0, 0, 3840, 2160), 144),
        Some(Rect::new(12 + 1264 * 2 + 24, 12, 1264, 2160 - 24))
    );
    // A work area too small for the gutters has no cells.
    let wide = SnapGrid {
        rows: 1,
        cols: 4,
        gap: 32,
    };
    assert_eq!(cell_frame(wide, 0, 0, Rect::new(0, 0, 100, 100), 96), None);
}

#[test]
fn zone_refs_serialise_as_the_ui_sends_them() {
    assert_eq!(
        serde_json::to_value(SnapZoneRef::BuiltIn(SnapZone::LeftHalf)).unwrap(),
        serde_json::json!({ "builtIn": "leftHalf" })
    );
    assert_eq!(
        serde_json::to_value(SnapZoneRef::Cell { row: 1, col: 2 }).unwrap(),
        serde_json::json!({ "cell": { "row": 1, "col": 2 } })
    );
    let parsed: SnapZoneRef =
        serde_json::from_value(serde_json::json!({ "builtIn": "centerThird" })).unwrap();
    assert_eq!(parsed, SnapZoneRef::BuiltIn(SnapZone::CenterThird));
}

// --- settings -------------------------------------------------------------------------------

#[test]
fn defaults_offer_every_built_in_and_no_grid() {
    let settings = WindowSnapSettings::default();
    assert_eq!(settings.zones, SnapZone::DEFAULT.to_vec());
    assert_eq!(settings.enabled_count(), MAX_ZONES);
    assert_eq!(settings.grid, None);
}

#[test]
fn a_grid_trims_the_built_ins_so_ten_zones_remain_in_all() {
    let settings = WindowSnapSettings {
        zones: SnapZone::DEFAULT.to_vec(),
        grid: Some(SnapGrid {
            rows: 2,
            cols: 3,
            gap: 8,
        }),
    }
    .normalised();
    assert_eq!(settings.zones.len(), 4);
    assert_eq!(settings.enabled_count(), 10);
    assert_eq!(&settings.zones[..], &SnapZone::DEFAULT[..4]);
}

#[test]
fn a_grid_larger_than_ten_cells_loses_columns_then_rows_and_the_gap_is_capped() {
    assert_eq!(
        SnapGrid {
            rows: 4,
            cols: 4,
            gap: 99
        }
        .normalised(),
        SnapGrid {
            rows: 3,
            cols: 3,
            gap: 32
        }
    );
    assert_eq!(
        SnapGrid {
            rows: 0,
            cols: 9,
            gap: 0
        }
        .normalised(),
        SnapGrid {
            rows: 1,
            cols: 4,
            gap: 0
        }
    );
}

#[test]
fn repeats_are_dropped_and_no_zones_at_all_reads_as_the_defaults() {
    let settings = WindowSnapSettings {
        zones: vec![SnapZone::LeftHalf, SnapZone::LeftHalf, SnapZone::Maximize],
        grid: None,
    }
    .normalised();
    assert_eq!(settings.zones, vec![SnapZone::LeftHalf, SnapZone::Maximize]);
    let empty = WindowSnapSettings {
        zones: Vec::new(),
        grid: None,
    }
    .normalised();
    assert_eq!(empty, WindowSnapSettings::default());
}

#[test]
fn a_malformed_namespace_reads_as_the_defaults_and_unknown_keys_are_ignored() {
    let mut settings = Settings::default();
    settings.modules.insert(
        WindowSnapSettings::KEY.to_owned(),
        serde_json::json!({ "zones": "leftHalf" }),
    );
    assert_eq!(
        WindowSnapSettings::from_document(&settings),
        WindowSnapSettings::default()
    );
    settings.modules.insert(
        WindowSnapSettings::KEY.to_owned(),
        serde_json::json!({
            "zones": ["rightHalf"],
            "grid": { "rows": 2, "cols": 2, "gap": 4 },
            "future": 1
        }),
    );
    let read = WindowSnapSettings::from_document(&settings);
    assert_eq!(read.zones, vec![SnapZone::RightHalf]);
    assert_eq!(read.enabled_count(), 5);
    let mut document = Settings::default();
    read.write(&mut document).unwrap();
    assert_eq!(WindowSnapSettings::from_document(&document), read);
}

#[test]
fn the_module_switch_follows_disabled_modules() {
    let h = harness();
    assert!(h.service.sessions().is_enabled());
    let mut document = Settings::default();
    document.shell.disabled_modules = vec![ID.to_owned()];
    h.service.apply_settings(&document);
    assert!(
        !h.service.sessions().is_enabled(),
        "the shell starts no session while the module is off"
    );
    h.service.apply_settings(&Settings::default());
    assert!(h.service.sessions().is_enabled());
}

// --- registry -------------------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_the_snap_surface_and_shares_its_sessions() {
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let clock = Arc::new(FakeClock::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().unwrap());
    let services = ModuleServices::new(
        &platform,
        &hub,
        None,
        &store,
        &(Arc::new(SystemClock) as Arc<dyn Clock>),
    );
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("window snap is registered");
    assert_eq!(backend.capabilities(), &[Surface::Snap]);
    assert_eq!(
        services.window_snap.settings(),
        WindowSnapSettings::default()
    );
    let sessions = services.window_snap.sessions();
    let id = sessions.begin(0x77);
    assert_eq!(services.window_snap.sessions().current().unwrap().id, id);
}

// --- placement ------------------------------------------------------------------------------

/// docs/modules/window-snap.md acceptance: "Drag Chrome to Left Half → exactly half the work
/// area", on the monitor the hovered notch belongs to.
#[test]
fn left_half_on_the_primary_places_the_frame_at_exactly_half_the_work_area() {
    let h = harness();
    let session = h.begin();
    h.service
        .apply(
            session,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::LeftHalf),
        )
        .unwrap();
    assert_eq!(
        h.platform.placement_calls(),
        vec![PlacementCall::Place(WINDOW, Rect::new(0, 0, 1280, 1400))]
    );
    assert_eq!(
        h.platform.window_placement().frame_bounds(WINDOW).unwrap(),
        Rect::new(0, 0, 1280, 1400)
    );
    assert!(
        h.service.sessions().current().is_none(),
        "the session is spent"
    );
}

#[test]
fn zones_on_the_secondary_use_its_offset_work_area_and_dpi() {
    let h = harness();
    let session = h.begin();
    h.service
        .apply(
            session,
            &secondary().id,
            SnapZoneRef::BuiltIn(SnapZone::RightHalf),
        )
        .unwrap();
    let session = h.begin();
    h.service
        .apply(
            session,
            &secondary().id,
            SnapZoneRef::BuiltIn(SnapZone::Maximize),
        )
        .unwrap();
    h.set_settings(&WindowSnapSettings {
        zones: vec![SnapZone::LeftHalf],
        grid: Some(SnapGrid {
            rows: 2,
            cols: 2,
            gap: 8,
        }),
    });
    let session = h.begin();
    h.service
        .apply(
            session,
            &secondary().id,
            SnapZoneRef::Cell { row: 0, col: 1 },
        )
        .unwrap();
    // 150 %: gap 12 px; inner 3840 - 36 = 3804 → 1902 each; 2100 - 36 = 2064 → 1032 each.
    assert_eq!(
        h.platform.placement_calls(),
        vec![
            PlacementCall::Place(WINDOW, Rect::new(4480, 0, 1920, 2100)),
            PlacementCall::Maximize(WINDOW, secondary().work_area),
            PlacementCall::Place(WINDOW, Rect::new(2560 + 12 + 1902 + 12, 12, 1902, 1032)),
        ]
    );
}

#[test]
fn the_work_area_is_read_at_apply_time_and_an_unplugged_monitor_falls_back_to_the_primary() {
    let h = harness();
    let session = h.begin();
    // The taskbar moved to the left edge since the drag began.
    let mut narrower = primary();
    narrower.work_area = Rect::new(60, 0, 2500, 1440);
    h.platform.set_monitors(vec![narrower]);
    h.service
        .apply(
            session,
            &secondary().id,
            SnapZoneRef::BuiltIn(SnapZone::TopRight),
        )
        .unwrap();
    assert_eq!(
        h.platform.placement_calls(),
        vec![PlacementCall::Place(WINDOW, Rect::new(1310, 0, 1250, 720))]
    );
}

#[test]
fn zones_the_settings_do_not_offer_are_refused_without_touching_the_window() {
    let h = harness();
    h.set_settings(&WindowSnapSettings {
        zones: vec![SnapZone::LeftHalf],
        grid: None,
    });
    let session = h.begin();
    let error = h
        .service
        .apply(
            session,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::RightHalf),
        )
        .unwrap_err();
    assert!(matches!(error, SnapError::ZoneNotOffered), "{error}");
    let session = h.begin();
    let error = h
        .service
        .apply(session, &primary().id, SnapZoneRef::Cell { row: 0, col: 0 })
        .unwrap_err();
    assert!(matches!(error, SnapError::ZoneNotOffered), "{error}");
    assert!(h.platform.placement_calls().is_empty());
}

#[test]
fn an_unknown_or_spent_session_is_an_error() {
    let h = harness();
    let error = h
        .service
        .apply(99, &primary().id, SnapZoneRef::BuiltIn(SnapZone::LeftHalf))
        .unwrap_err();
    assert!(matches!(error, SnapError::UnknownSession), "{error}");
    let session = h.begin();
    assert!(h.service.cancel(session));
    assert!(!h.service.cancel(session));
    let error = h
        .service
        .apply(
            session,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::LeftHalf),
        )
        .unwrap_err();
    assert!(matches!(error, SnapError::UnknownSession), "{error}");
    assert!(h.platform.placement_calls().is_empty());
}

/// docs/build-plan/m4-power-tools.md "Risks": Aero Snap may re-maximise the window as the
/// drag ends, and a per-monitor-DPI window resizes itself after crossing monitors — the frame
/// is checked after a moment and placed once more.
#[test]
fn a_window_that_did_not_stay_put_is_placed_once_more() {
    let h = harness();
    assert!(h.platform.set_foreign_window_stuck(WINDOW, true));
    let session = h.begin();
    h.service
        .apply(
            session,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::LeftHalf),
        )
        .unwrap();
    let target = Rect::new(0, 0, 1280, 1400);
    assert_eq!(
        h.platform.placement_calls(),
        vec![
            PlacementCall::Place(WINDOW, target),
            PlacementCall::Place(WINDOW, target)
        ],
        "one placement, one check, one re-apply — never a loop"
    );
}

#[test]
fn a_window_that_refuses_placement_surfaces_the_platform_error_unchanged() {
    let h = harness();
    h.platform
        .set_placement_error(Some(PlatformError::AccessDenied("elevated window")));
    let session = h.begin();
    let error = h
        .service
        .apply(
            session,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::LeftHalf),
        )
        .unwrap_err();
    assert!(
        matches!(
            error,
            SnapError::Platform(PlatformError::AccessDenied("elevated window"))
        ),
        "{error}"
    );
}

#[test]
fn a_new_drag_replaces_the_previous_session() {
    let h = harness();
    let sessions = h.service.sessions();
    let first = sessions.begin(WINDOW);
    let second = sessions.begin(0x2000);
    assert_ne!(first, second);
    let error = h
        .service
        .apply(
            first,
            &primary().id,
            SnapZoneRef::BuiltIn(SnapZone::LeftHalf),
        )
        .unwrap_err();
    assert!(matches!(error, SnapError::UnknownSession), "{error}");
    assert_eq!(sessions.current().unwrap().window, 0x2000);
}
