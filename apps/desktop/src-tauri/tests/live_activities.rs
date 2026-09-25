//! The `live-activities` sources against `FakePlatform` and `FakeClock` (docs/modules/
//! live-activities.md "Built-in notices", docs/09-testing-qa.md S8). Integration tests because
//! the `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;

use muna_core::{
    FakeClock, Hub, Leading, StripContent, StripMessage, Trailing, activities::priority,
};
use muna_lib::modules::live_activities::Sources;
use muna_lib::modules::live_activities::power::{LOW_THRESHOLDS, PowerSource};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{
    BatteryState, BluetoothDevice, FakePlatform, PlatformEvent, PowerSource as Source,
};

fn battery(percent: u8, source: Source, charging: bool) -> BatteryState {
    BatteryState {
        percent: Some(percent),
        source,
        charging,
    }
}

fn on_battery(percent: u8) -> BatteryState {
    battery(percent, Source::Battery, false)
}

fn charging(percent: u8) -> BatteryState {
    battery(percent, Source::Ac, true)
}

fn buds(connected: bool, battery_percent: Option<u8>) -> BluetoothDevice {
    BluetoothDevice {
        id: "bt-1".into(),
        name: "Galaxy Buds".into(),
        connected,
        battery_percent,
        // Unclassified on purpose: the name alone must still earn the headphones glyph.
        kind: muna_platform::BluetoothDeviceKind::Other,
    }
}

fn setup() -> (Arc<FakePlatform>, Arc<FakeClock>, Hub, Sources) {
    let platform = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new());
    let hub = Hub::new(Arc::clone(&clock) as Arc<dyn muna_core::Clock>);
    let sources = Sources::seeded(platform.as_ref());
    (platform, clock, hub, sources)
}

fn shown_notice_id(hub: &Hub) -> Option<String> {
    match hub.current() {
        StripContent::Notice { notice } => Some(notice.id),
        _ => None,
    }
}

// --- power ---------------------------------------------------------------------------------

#[test]
fn first_reading_only_seeds_the_power_source() {
    let mut power = PowerSource::default();
    assert!(power.observe(on_battery(80)).is_empty());
    assert!(power.observe(on_battery(79)).is_empty());
}

#[test]
fn plugging_in_shows_the_charging_notice_with_percentage() {
    let mut power = PowerSource::new(Some(on_battery(57)));
    let notices = power.observe(charging(57));
    assert_eq!(notices.len(), 1);
    let notice = &notices[0];
    assert_eq!(notice.id, "power:charging");
    assert_eq!(notice.priority, priority::POWER);
    assert_eq!(
        notice.leading,
        Some(Leading::Battery {
            percent: 57,
            charging: true
        })
    );
    assert_eq!(notice.trailing, Some(Trailing::Percent { value: 57 }));
    assert!(notice.wide.is_none(), "charging is compact, no text");
}

#[test]
fn unplugging_shows_the_on_battery_notice() {
    let mut power = PowerSource::new(Some(charging(90)));
    let notices = power.observe(on_battery(90));
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].id, "power:unplugged");
    assert_eq!(
        notices[0].leading,
        Some(Leading::Battery {
            percent: 90,
            charging: false
        })
    );
}

#[test]
fn repeated_identical_readings_are_silent() {
    let mut power = PowerSource::new(Some(charging(57)));
    // WM_POWERBROADCAST is delivered several times per plug event.
    assert!(power.observe(charging(57)).is_empty());
    assert!(power.observe(charging(58)).is_empty());
}

#[test]
fn low_battery_notices_fire_once_per_threshold_while_discharging() {
    let mut power = PowerSource::new(Some(on_battery(22)));
    assert!(power.observe(on_battery(21)).is_empty());
    let at_twenty = power.observe(on_battery(20));
    assert_eq!(at_twenty.len(), 1);
    assert_eq!(at_twenty[0].id, format!("power:low:{}", LOW_THRESHOLDS[0]));
    assert_eq!(
        at_twenty[0].wide,
        Some(StripMessage::BatteryLow { percent: 20 })
    );
    assert!(
        power.observe(on_battery(19)).is_empty(),
        "no repeat below 20"
    );
    let at_ten = power.observe(on_battery(9));
    assert_eq!(
        at_ten.len(),
        1,
        "skipping straight past 10 still fires once"
    );
    assert_eq!(at_ten[0].id, format!("power:low:{}", LOW_THRESHOLDS[1]));
    assert!(power.observe(on_battery(5)).is_empty());
}

#[test]
fn low_battery_is_not_raised_while_charging() {
    let mut power = PowerSource::new(Some(charging(21)));
    assert!(power.observe(charging(20)).is_empty());
    assert!(power.observe(charging(9)).is_empty());
}

#[test]
fn machines_without_a_battery_never_notify() {
    let desktop = BatteryState {
        percent: None,
        source: Source::Ac,
        charging: false,
    };
    let mut power = PowerSource::new(Some(desktop));
    assert!(power.observe(desktop).is_empty());
    assert!(
        power
            .observe(BatteryState {
                source: Source::Battery,
                ..desktop
            })
            .is_empty()
    );
}

// --- bluetooth -----------------------------------------------------------------------------

#[test]
fn bluetooth_connect_and_disconnect_notify_once_each() {
    let (platform, _clock, hub, mut sources) = setup();
    platform.set_bluetooth_device(buds(true, Some(80)));
    let event = PlatformEvent::BluetoothChanged(buds(true, Some(80)));
    assert_eq!(sources.apply(&event, &hub), 1);
    let StripContent::Notice { notice } = hub.current() else {
        panic!("expected a notice");
    };
    assert_eq!(notice.id, "bluetooth:bt-1");
    assert_eq!(notice.priority, priority::BLUETOOTH);
    assert_eq!(
        notice.wide,
        Some(StripMessage::BluetoothConnected {
            name: "Galaxy Buds".into(),
            battery_percent: Some(80),
        })
    );
    assert_eq!(
        notice.trailing,
        Some(Trailing::Battery {
            percent: 80,
            charging: false
        })
    );
    assert!(
        matches!(
            notice.leading,
            Some(Leading::Icon {
                glyph: muna_core::Glyph::Headphones,
                ..
            })
        ),
        "buds get the headphones glyph"
    );

    // A later battery report for a connected device is not a new connection.
    let refresh = PlatformEvent::BluetoothChanged(buds(true, Some(75)));
    assert_eq!(sources.apply(&refresh, &hub), 0);

    let gone = PlatformEvent::BluetoothChanged(buds(false, None));
    assert_eq!(sources.apply(&gone, &hub), 1);
    let StripContent::Notice { notice } = hub.current() else {
        panic!("expected a notice");
    };
    assert_eq!(
        notice.wide,
        Some(StripMessage::BluetoothDisconnected {
            name: "Galaxy Buds".into(),
        })
    );
    // Disconnecting an unknown device says nothing.
    assert_eq!(sources.apply(&gone, &hub), 0);
}

#[test]
fn devices_connected_at_start_up_do_not_announce_themselves() {
    let platform = Arc::new(FakePlatform::new());
    platform.set_bluetooth_device(buds(true, Some(80)));
    let clock = Arc::new(FakeClock::new());
    let hub = Hub::new(clock as Arc<dyn muna_core::Clock>);
    let mut sources = Sources::seeded(platform.as_ref());
    let event = PlatformEvent::BluetoothChanged(buds(true, Some(80)));
    assert_eq!(sources.apply(&event, &hub), 0);
    assert_eq!(hub.current(), StripContent::Idle);
}

// --- session -------------------------------------------------------------------------------

#[test]
fn lock_and_unlock_notices_are_glyph_only() {
    let (_platform, _clock, hub, mut sources) = setup();
    sources.apply(&PlatformEvent::SessionLockChanged { locked: true }, &hub);
    let StripContent::Notice { notice } = hub.current() else {
        panic!("expected a notice");
    };
    assert_eq!(notice.id, "session:locked");
    assert_eq!(
        notice.leading,
        Some(Leading::Icon {
            glyph: muna_core::Glyph::Lock,
            tint: None
        })
    );
    assert!(notice.wide.is_none());
    assert_eq!(notice.priority, priority::SESSION);

    sources.apply(&PlatformEvent::SessionLockChanged { locked: false }, &hub);
    assert_eq!(shown_notice_id(&hub).as_deref(), Some("session:unlocked"));
}

// --- end to end through the hub --------------------------------------------------------

#[test]
fn power_notice_holds_then_clears_on_the_hub() {
    let platform = Arc::new(FakePlatform::new());
    platform.set_battery(on_battery(50));
    let clock = Arc::new(FakeClock::new());
    let hub = Hub::new(Arc::clone(&clock) as Arc<dyn muna_core::Clock>);
    // Seeded from the platform, so the first event is compared with a real reading.
    let mut sources = Sources::seeded(platform.as_ref());
    sources.apply(&PlatformEvent::BatteryChanged(on_battery(49)), &hub);
    assert_eq!(
        hub.current(),
        StripContent::Idle,
        "a level change is silent"
    );

    sources.apply(&PlatformEvent::BatteryChanged(charging(50)), &hub);
    assert_eq!(shown_notice_id(&hub).as_deref(), Some("power:charging"));
    assert!(hub.next_deadline().is_some(), "the hold is scheduled");

    clock.advance(muna_core::activities::NOTICE_HOLD);
    hub.refresh();
    assert_eq!(hub.current(), StripContent::Idle);
}

#[test]
fn s8_notice_during_panel_queues_until_resume() {
    let (_platform, _clock, hub, mut sources) = setup();
    hub.set_suspended("notch", true);
    sources.apply(&PlatformEvent::SessionLockChanged { locked: true }, &hub);
    assert_eq!(
        hub.current(),
        StripContent::Idle,
        "queued while the panel shows"
    );
    hub.set_suspended("notch", false);
    assert_eq!(shown_notice_id(&hub).as_deref(), Some("session:locked"));
}

// --- registry ----------------------------------------------------------------------------

#[test]
fn registry_lists_live_activities_with_strip_capability() {
    let platform: Arc<dyn muna_platform::Platform> = Arc::new(FakePlatform::new());
    let clock: Arc<dyn muna_core::Clock> = Arc::new(muna_core::SystemClock);
    let hub = Arc::new(Hub::new(Arc::clone(&clock)));
    let store = Arc::new(muna_core::Store::open_in_memory().expect("in-memory store"));
    let all = backends(&ModuleServices::new(&platform, &hub, None, &store, &clock));
    let live = all
        .iter()
        .find(|backend| backend.id() == "live-activities")
        .expect("live-activities is always registered");
    assert_eq!(live.capabilities(), &[Surface::Strip]);
    let media = all
        .iter()
        .find(|backend| backend.id() == "media")
        .expect("media is always registered");
    assert_eq!(media.capabilities(), &[Surface::Strip, Surface::Panel]);
    let pomodoro = all
        .iter()
        .find(|backend| backend.id() == "pomodoro")
        .expect("pomodoro is always registered");
    assert_eq!(pomodoro.capabilities(), &[Surface::Strip, Surface::Panel]);
    let todo = all
        .iter()
        .find(|backend| backend.id() == "todo")
        .expect("todo is always registered");
    assert_eq!(todo.capabilities(), &[Surface::Strip, Surface::Panel]);
}
