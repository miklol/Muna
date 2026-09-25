//! The `bluetooth` module against `FakePlatform` (docs/modules/bluetooth.md acceptance
//! criteria, docs/build-plan/m3-daily-modules.md E7). Integration tests because the `muna` lib
//! cannot host unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;
use std::time::Duration;

use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, StripContent, StripMessage, StripSink, Tint,
    Trailing,
    activities::{NOTICE_HOLD, priority},
};
use muna_lib::modules::bluetooth::{
    BluetoothCommand, BluetoothService, BluetoothSettings, BluetoothSink, BluetoothSnapshot, ID,
    LOW_THRESHOLDS,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{
    BluetoothCall, BluetoothDevice, BluetoothDeviceKind, BluetoothRadioState, FakePlatform,
    Platform, PlatformError, PlatformEvent,
};
use parking_lot::Mutex;

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<BluetoothSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl BluetoothSink for Recorder {
    fn changed(&self, snapshot: &BluetoothSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    service: Arc<BluetoothService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    /// A service seeded from whatever `script` puts on the fake first.
    fn new(script: impl FnOnce(&FakePlatform)) -> Self {
        let clock = Arc::new(FakeClock::new());
        let platform = Arc::new(FakePlatform::new());
        script(&platform);
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let service = Arc::new(BluetoothService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn BluetoothSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        service.seed();
        Self {
            clock,
            platform,
            hub,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: &BluetoothSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    /// What the backend loop does: hand the platform's report to the service.
    fn report(&self, device: BluetoothDevice) {
        self.platform.set_bluetooth_device(device.clone());
        self.service
            .observe(&PlatformEvent::BluetoothChanged(device));
    }

    fn shown_notice_id(&self) -> Option<String> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice.id),
            _ => None,
        }
    }

    /// Lets whatever notice is showing run out, so the next publication is visible again.
    fn expire_notices(&self) {
        self.clock.advance(NOTICE_HOLD + Duration::from_secs(1));
        self.hub.refresh();
        assert_eq!(self.shown_notice_id(), None, "the strip is clear again");
    }

    fn snapshots(&self) -> usize {
        self.recorder.snapshots.lock().len()
    }
}

fn device(id: &str, name: &str, connected: bool, battery_percent: Option<u8>) -> BluetoothDevice {
    BluetoothDevice {
        id: id.into(),
        name: name.into(),
        connected,
        battery_percent,
        kind: BluetoothDeviceKind::Headphones,
    }
}

fn names(snapshot: &BluetoothSnapshot) -> Vec<&str> {
    snapshot
        .devices
        .iter()
        .map(|device| device.name.as_str())
        .collect()
}

// --- snapshot ------------------------------------------------------------------------------

#[test]
fn the_seed_lists_paired_devices_connected_first_then_by_name() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("m", "Mouse", false, None));
        fake.set_bluetooth_device(device("k", "Keyboard", false, None));
        fake.set_bluetooth_device(device("b", "Buds", true, Some(80)));
        fake.set_bluetooth_device(device("a", "Watch", true, None));
    });
    let snapshot = rig.service.snapshot();
    assert!(snapshot.available);
    assert_eq!(snapshot.radio, BluetoothRadioState::On);
    assert_eq!(names(&snapshot), ["Buds", "Watch", "Keyboard", "Mouse"]);
    assert_eq!(snapshot.devices[0].battery_percent, Some(80));
    assert_eq!(snapshot.devices[0].kind, BluetoothDeviceKind::Headphones);
    assert!(snapshot.devices.iter().all(|d| !d.hidden));
    assert_eq!(rig.snapshots(), 1, "the seed reaches the sink once");
}

#[test]
fn a_platform_without_bluetooth_reads_as_unavailable() {
    let clock = Arc::new(FakeClock::new());
    let platform = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let service = BluetoothService::new(Arc::clone(&platform) as Arc<dyn Platform>, hub);
    // Before `seed`, nothing is known.
    let before = service.snapshot();
    assert!(!before.available);
    assert_eq!(before.radio, BluetoothRadioState::Unavailable);
    assert!(before.devices.is_empty());
}

#[test]
fn a_device_report_updates_the_snapshot_and_reaches_the_sink() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", false, None));
    });
    rig.report(device("b", "Buds", true, Some(64)));
    let snapshot = rig.service.snapshot();
    assert!(snapshot.devices[0].connected);
    assert_eq!(snapshot.devices[0].battery_percent, Some(64));
    assert_eq!(rig.snapshots(), 2);
}

#[test]
fn unrelated_platform_events_are_ignored() {
    let rig = Rig::new(|_| {});
    assert!(!rig.service.observe(&PlatformEvent::BatteryChanged(
        muna_platform::BatteryState {
            percent: Some(50),
            source: muna_platform::PowerSource::Battery,
            charging: false,
        }
    )));
    assert_eq!(rig.snapshots(), 1);
}

// --- commands ------------------------------------------------------------------------------

#[test]
fn connect_asks_the_platform_and_marks_the_device_connected() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", false, None));
    });
    let snapshot = rig
        .service
        .command(BluetoothCommand::Connect { id: "b".into() })
        .expect("connect");
    assert_eq!(
        rig.platform.bluetooth_calls(),
        [BluetoothCall::Connect("b".into())]
    );
    assert!(snapshot.devices[0].connected);
}

#[test]
fn disconnect_asks_the_platform_and_clears_the_battery() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(40)));
    });
    let snapshot = rig
        .service
        .command(BluetoothCommand::Disconnect { id: "b".into() })
        .expect("disconnect");
    assert_eq!(
        rig.platform.bluetooth_calls(),
        [BluetoothCall::Disconnect("b".into())]
    );
    assert!(!snapshot.devices[0].connected);
    assert_eq!(snapshot.devices[0].battery_percent, None);
}

#[test]
fn a_device_that_will_not_connect_surfaces_the_platform_error_unchanged() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", false, None));
        fake.set_bluetooth_unsupported(true);
    });
    let error = rig
        .service
        .command(BluetoothCommand::Connect { id: "b".into() })
        .expect_err("connect refused");
    assert!(matches!(error, PlatformError::Unsupported(_)), "{error:?}");
    assert!(!rig.service.snapshot().devices[0].connected);
    assert_eq!(rig.snapshots(), 1, "a failed command changes nothing");
}

#[test]
fn an_unknown_device_is_not_found() {
    let rig = Rig::new(|_| {});
    let error = rig
        .service
        .command(BluetoothCommand::Disconnect { id: "ghost".into() })
        .expect_err("unknown");
    assert!(matches!(error, PlatformError::NotFound(_)), "{error:?}");
}

#[test]
fn the_radio_toggle_goes_through_the_platform_and_updates_the_snapshot() {
    let rig = Rig::new(|_| {});
    let snapshot = rig
        .service
        .command(BluetoothCommand::SetRadio { on: false })
        .expect("radio off");
    assert_eq!(snapshot.radio, BluetoothRadioState::Off);
    assert_eq!(
        rig.platform.bluetooth_calls(),
        [BluetoothCall::SetRadio(false)]
    );
    assert_eq!(rig.platform.bluetooth().radio(), BluetoothRadioState::Off);
}

#[test]
fn a_radio_the_system_refuses_to_switch_is_access_denied() {
    let rig = Rig::new(|fake| fake.set_bluetooth_radio_denied(true));
    let error = rig
        .service
        .command(BluetoothCommand::SetRadio { on: false })
        .expect_err("denied");
    assert!(matches!(error, PlatformError::AccessDenied(_)), "{error:?}");
    assert_eq!(rig.service.snapshot().radio, BluetoothRadioState::On);
}

#[test]
fn the_os_switching_the_radio_reaches_the_snapshot() {
    let rig = Rig::new(|_| {});
    rig.platform.set_bluetooth_radio(BluetoothRadioState::Off);
    assert!(rig.service.observe(&PlatformEvent::BluetoothRadioChanged(
        BluetoothRadioState::Off
    )));
    assert_eq!(rig.service.snapshot().radio, BluetoothRadioState::Off);
    assert!(
        !rig.service.observe(&PlatformEvent::BluetoothRadioChanged(
            BluetoothRadioState::Off
        )),
        "a repeated state is not a change"
    );
    assert_eq!(rig.snapshots(), 2);
}

// --- hidden devices ------------------------------------------------------------------------

#[test]
fn hidden_devices_stay_in_the_snapshot_flagged() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(80)));
        fake.set_bluetooth_device(device("m", "Mouse", false, None));
    });
    rig.apply(&BluetoothSettings {
        hidden_devices: vec!["m".into()],
        ..BluetoothSettings::default()
    });
    let snapshot = rig.service.snapshot();
    assert_eq!(names(&snapshot), ["Buds", "Mouse"]);
    assert!(!snapshot.devices[0].hidden);
    assert!(snapshot.devices[1].hidden);
    assert_eq!(rig.snapshots(), 2, "a settings change re-emits");
    rig.apply(&BluetoothSettings {
        hidden_devices: vec!["m".into()],
        ..BluetoothSettings::default()
    });
    assert_eq!(rig.snapshots(), 2, "an unchanged document does not");
}

#[test]
fn the_settings_namespace_round_trips_and_tolerates_junk() {
    let settings = BluetoothSettings {
        low_battery_notices: false,
        hidden_devices: vec!["a".into(), "b".into()],
    };
    let mut document = Settings::default();
    settings.write(&mut document).expect("write");
    assert_eq!(BluetoothSettings::from_document(&document), settings);
    assert_eq!(BluetoothSettings::KEY, ID);

    let mut junk = Settings::default();
    junk.modules.insert(
        ID.into(),
        serde_json::json!({ "lowBatteryNotices": "loud" }),
    );
    assert_eq!(
        BluetoothSettings::from_document(&junk),
        BluetoothSettings::default()
    );
    assert_eq!(
        BluetoothSettings::from_document(&Settings::default()),
        BluetoothSettings::default()
    );
}

// --- low-battery notices -------------------------------------------------------------------

#[test]
fn a_connected_device_dropping_to_twenty_percent_earns_an_orange_notice() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(35)));
    });
    rig.report(device("b", "Buds", true, Some(21)));
    assert_eq!(rig.shown_notice_id(), None);
    rig.report(device("b", "Buds", true, Some(20)));
    assert_eq!(rig.shown_notice_id().as_deref(), Some("bluetooth:low:b"));
    let StripContent::Notice { notice } = rig.hub.current() else {
        panic!("a notice is showing");
    };
    assert_eq!(notice.module, ID);
    assert_eq!(notice.priority, priority::BLUETOOTH);
    assert_eq!(
        notice.leading,
        Some(Leading::Icon {
            glyph: Glyph::Headphones,
            tint: Some(Tint::Orange),
        })
    );
    assert_eq!(
        notice.trailing,
        Some(Trailing::Battery {
            percent: 20,
            charging: false,
        })
    );
    assert_eq!(
        notice.wide,
        Some(StripMessage::DeviceBatteryLow {
            name: "Buds".into(),
            percent: 20,
        })
    );
}

#[test]
fn each_threshold_is_announced_once_and_ten_percent_is_red() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(50)));
    });
    rig.report(device("b", "Buds", true, Some(19)));
    assert_eq!(rig.shown_notice_id().as_deref(), Some("bluetooth:low:b"));
    rig.expire_notices();
    rig.report(device("b", "Buds", true, Some(15)));
    rig.report(device("b", "Buds", true, Some(11)));
    assert_eq!(rig.shown_notice_id(), None, "the 20 % band is told once");
    rig.report(device("b", "Buds", true, Some(LOW_THRESHOLDS[1])));
    let StripContent::Notice { notice } = rig.hub.current() else {
        panic!("a notice is showing");
    };
    assert_eq!(
        notice.leading,
        Some(Leading::Icon {
            glyph: Glyph::Headphones,
            tint: Some(Tint::Red),
        })
    );
    assert_eq!(
        notice.wide,
        Some(StripMessage::DeviceBatteryLow {
            name: "Buds".into(),
            percent: 10,
        })
    );
    rig.expire_notices();
    rig.report(device("b", "Buds", true, Some(5)));
    assert_eq!(
        rig.shown_notice_id(),
        None,
        "the 10 % band is told once too"
    );
}

#[test]
fn a_device_already_low_at_startup_is_not_announced() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(12)));
    });
    rig.report(device("b", "Buds", true, Some(11)));
    assert_eq!(rig.shown_notice_id(), None, "already true at start-up");
    rig.report(device("b", "Buds", true, Some(9)));
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("bluetooth:low:b"),
        "the next band still is"
    );
}

#[test]
fn charging_above_the_band_or_reconnecting_re_arms_the_notices() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(50)));
    });
    rig.report(device("b", "Buds", true, Some(20)));
    assert_eq!(rig.shown_notice_id().as_deref(), Some("bluetooth:low:b"));
    rig.expire_notices();
    rig.report(device("b", "Buds", true, Some(60)));
    rig.report(device("b", "Buds", true, Some(20)));
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("bluetooth:low:b"),
        "back above 20 % re-arms"
    );
    rig.expire_notices();
    rig.report(device("b", "Buds", false, None));
    rig.report(device("b", "Buds", true, Some(18)));
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("bluetooth:low:b"),
        "a reconnect re-arms"
    );
}

#[test]
fn a_disconnected_device_is_never_low() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", false, None));
    });
    rig.report(device("b", "Buds", false, Some(5)));
    assert_eq!(rig.shown_notice_id(), None);
}

#[test]
fn low_battery_notices_can_be_turned_off() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(50)));
    });
    rig.apply(&BluetoothSettings {
        low_battery_notices: false,
        ..BluetoothSettings::default()
    });
    rig.report(device("b", "Buds", true, Some(20)));
    rig.report(device("b", "Buds", true, Some(10)));
    assert_eq!(rig.shown_notice_id(), None);
}

#[test]
fn disconnecting_through_the_module_re_arms_too() {
    let rig = Rig::new(|fake| {
        fake.set_bluetooth_device(device("b", "Buds", true, Some(50)));
    });
    rig.report(device("b", "Buds", true, Some(20)));
    rig.expire_notices();
    rig.service
        .command(BluetoothCommand::Disconnect { id: "b".into() })
        .expect("disconnect");
    rig.report(device("b", "Buds", true, Some(20)));
    assert_eq!(rig.shown_notice_id().as_deref(), Some("bluetooth:low:b"));
}

// --- registry ------------------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_strip_and_panel() {
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
        .expect("bluetooth is registered");
    assert_eq!(backend.capabilities(), [Surface::Strip, Surface::Panel]);
}
