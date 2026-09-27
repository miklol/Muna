//! The `mirror` module (docs/modules/mirror.md, M5-E1c): the settings namespace, the camera
//! permission that follows it, the preview watchers that hold the memory target, and the
//! registry entry. Integration tests because the `muna` lib cannot host unit tests (Common
//! Controls manifest on Tauri-linked tests). Nothing here opens a camera: the frames never
//! reach Rust, and the permission handler itself is exercised by `muna-platform`'s policy
//! tests plus the manual rows in `docs/qa/checklists/mirror.md`.

use std::sync::Arc;

use muna_core::{Clock, FakeClock, Hub, Settings, Store};
use muna_lib::modules::mirror::{ID, MirrorService, MirrorSettings, PreviewSink};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, PermissionDecision, Platform, WebPermission};
use parking_lot::Mutex;

const APP_ORIGIN: &str = "http://tauri.localhost/";

#[derive(Debug, Default)]
struct RecordingSink {
    transitions: Mutex<Vec<bool>>,
}

impl PreviewSink for RecordingSink {
    fn previewing(&self, active: bool) {
        self.transitions.lock().push(active);
    }
}

fn service() -> (Arc<MirrorService>, Arc<RecordingSink>) {
    let service = Arc::new(MirrorService::new());
    let sink = Arc::new(RecordingSink::default());
    service.set_sink(Arc::clone(&sink) as Arc<dyn PreviewSink>);
    (service, sink)
}

fn document(settings: &MirrorSettings) -> Settings {
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    document
}

fn enabled() -> MirrorSettings {
    MirrorSettings {
        enabled: true,
        ..MirrorSettings::default()
    }
}

#[test]
fn registry_has_the_module_with_a_panel_and_a_widget() {
    let platform: Arc<dyn Platform> = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().unwrap());
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
        .expect("mirror is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel, Surface::Widget]);
    assert_eq!(services.mirror.settings(), MirrorSettings::default());
    assert!(
        !services.mirror.permissions().camera_allowed(),
        "the camera is locked until the user turns the module on"
    );
    assert!(!services.mirror.previewing());
}

#[test]
fn the_camera_permission_follows_the_enabled_setting() {
    let (service, _sink) = service();
    let policy = service.permissions();
    assert_eq!(
        policy.decide(WebPermission::Camera, APP_ORIGIN, APP_ORIGIN),
        PermissionDecision::Deny,
        "off by default"
    );

    service.apply_settings(&document(&enabled()));
    assert!(service.settings().enabled);
    assert_eq!(
        policy.decide(WebPermission::Camera, APP_ORIGIN, APP_ORIGIN),
        PermissionDecision::Allow
    );
    assert_eq!(
        policy.decide(WebPermission::Camera, "http://evil.example/", APP_ORIGIN),
        PermissionDecision::Deny,
        "another origin never gets the camera"
    );
    assert_eq!(
        policy.decide(WebPermission::Microphone, APP_ORIGIN, APP_ORIGIN),
        PermissionDecision::Deny,
        "only the camera is ever granted"
    );

    service.apply_settings(&Settings::default());
    assert!(!service.settings().enabled);
    assert_eq!(
        policy.decide(WebPermission::Camera, APP_ORIGIN, APP_ORIGIN),
        PermissionDecision::Deny
    );
}

#[test]
fn settings_round_trip_with_the_chosen_camera() {
    let (service, _sink) = service();
    let chosen = MirrorSettings {
        enabled: true,
        flip: false,
        device_id: Some("cam-2".to_owned()),
        device_label: Some("Desk camera".to_owned()),
    };
    service.apply_settings(&document(&chosen));
    assert_eq!(service.settings(), chosen);

    // A malformed namespace falls back to the defaults, which also locks the camera again.
    let mut broken = Settings::default();
    broken
        .modules
        .insert(ID.to_owned(), serde_json::json!({ "enabled": 3 }));
    service.apply_settings(&broken);
    assert_eq!(service.settings(), MirrorSettings::default());
    assert!(!service.permissions().camera_allowed());
}

#[test]
fn previews_hold_once_across_windows_and_release_with_the_last() {
    let (service, sink) = service();
    service.apply_settings(&document(&enabled()));

    service.watch("notch", true);
    assert!(service.previewing());
    assert_eq!(*sink.transitions.lock(), vec![true]);

    // A second window and a repeat from the first change nothing.
    service.watch("notch-2", true);
    service.watch("notch", true);
    assert_eq!(*sink.transitions.lock(), vec![true]);

    service.watch("notch", false);
    assert!(service.previewing(), "the second window still previews");
    assert_eq!(*sink.transitions.lock(), vec![true]);

    // A window destroyed mid-preview releases like a stop would.
    service.forget_window("notch-2");
    assert!(!service.previewing());
    assert_eq!(*sink.transitions.lock(), vec![true, false]);

    // Stopping what never started is a no-op.
    service.watch("notch-3", false);
    service.forget_window("notch");
    assert_eq!(*sink.transitions.lock(), vec![true, false]);
}

#[test]
fn a_preview_cannot_be_reported_while_the_camera_is_locked() {
    let (service, sink) = service();
    service.watch("notch", true);
    assert!(!service.previewing());
    assert!(sink.transitions.lock().is_empty());

    // Stopping is always accepted, so a page that lost the permission mid-stream can still
    // report the end of its preview.
    service.apply_settings(&document(&enabled()));
    service.watch("notch", true);
    service.apply_settings(&Settings::default());
    service.watch("notch", false);
    assert!(!service.previewing());
    assert_eq!(*sink.transitions.lock(), vec![true, false]);
}

#[test]
fn turning_the_module_off_releases_every_preview() {
    let (service, sink) = service();
    service.apply_settings(&document(&enabled()));
    service.watch("notch", true);
    service.watch("notch-2", true);
    assert_eq!(*sink.transitions.lock(), vec![true]);

    service.apply_settings(&document(&MirrorSettings::default()));
    assert!(!service.previewing());
    assert_eq!(*sink.transitions.lock(), vec![true, false]);

    // Off again with nothing running reports nothing more; flipping an unrelated field while
    // on does not disturb a running preview.
    service.apply_settings(&document(&MirrorSettings::default()));
    service.apply_settings(&document(&enabled()));
    service.watch("notch", true);
    service.apply_settings(&document(&MirrorSettings {
        flip: false,
        ..enabled()
    }));
    assert!(service.previewing());
    assert_eq!(*sink.transitions.lock(), vec![true, false, true]);
}

#[test]
fn a_service_without_a_sink_still_tracks_previews() {
    let service = MirrorService::new();
    service.apply_settings(&document(&enabled()));
    service.watch("notch", true);
    assert!(service.previewing());
    service.watch("notch", false);
    assert!(!service.previewing());
}
