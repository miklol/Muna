//! The `system-monitor` module against `FakePlatform` and `FakeClock`
//! (docs/modules/system-monitor.md acceptance criteria, docs/build-plan/m3-daily-modules.md
//! E8). Integration tests because the `muna` lib cannot host unit tests (Common Controls
//! manifest on Tauri-linked tests).

use std::sync::Arc;
use std::time::Duration;

use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, StripContent, StripSink, Trailing,
    activities::priority,
};
use muna_lib::modules::system_monitor::{
    CPU_ACTIVITY_ID, RATE_WINDOW_MAX, STRIP_PERIOD, SystemMonitorService, SystemMonitorSettings,
    SystemMonitorSink, SystemMonitorSnapshot, VISIBLE_PERIOD, bytes_per_second,
};
use muna_platform::{
    BatteryState, DiskSpace, FakePlatform, Platform, PowerSource, ProcessUsage, SystemSample,
};
use parking_lot::Mutex;

const GIB: u64 = 1024 * 1024 * 1024;
const NOTCH: &str = "notch-0";

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<SystemMonitorSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl SystemMonitorSink for Recorder {
    fn changed(&self, snapshot: &SystemMonitorSnapshot) {
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
    service: Arc<SystemMonitorService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_settings(&SystemMonitorSettings::default())
    }

    fn with_settings(settings: &SystemMonitorSettings) -> Self {
        let clock = Arc::new(FakeClock::new());
        let platform = Arc::new(FakePlatform::new());
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let service = Arc::new(SystemMonitorService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
            Arc::clone(&clock) as Arc<dyn Clock>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn SystemMonitorSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        service.apply_settings(&document);
        Self {
            clock,
            platform,
            hub,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: &SystemMonitorSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    /// What the backend loop does at each tick: let the period pass, then sample.
    fn tick(&self, period: Duration) -> Option<SystemMonitorSnapshot> {
        self.clock.advance(period);
        self.hub.refresh();
        self.service.sample()
    }

    fn strip_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|held| held.activity)
            .find(|activity| activity.id == CPU_ACTIVITY_ID)
    }
}

/// A plausible laptop: 16 GiB, a 1 TiB system volume, a USB stick and a few processes.
fn sample(cpu: Option<f32>, received: u64, transmitted: u64) -> SystemSample {
    SystemSample {
        cpu_percent: cpu,
        logical_cpus: 8,
        memory_used_bytes: 9 * GIB,
        memory_total_bytes: 16 * GIB,
        disks: vec![
            DiskSpace {
                name: "Windows".into(),
                mount: "C:\\".into(),
                total_bytes: 1000 * GIB,
                available_bytes: 250 * GIB,
                removable: false,
                system: true,
            },
            DiskSpace {
                name: "Data".into(),
                mount: "D:\\".into(),
                total_bytes: 2000 * GIB,
                available_bytes: 1500 * GIB,
                removable: false,
                system: false,
            },
            DiskSpace {
                name: "USB".into(),
                mount: "E:\\".into(),
                total_bytes: 64 * GIB,
                available_bytes: 10 * GIB,
                removable: true,
                system: false,
            },
        ],
        network_received_bytes: received,
        network_transmitted_bytes: transmitted,
        processes: vec![
            ProcessUsage {
                name: "chrome".into(),
                cpu_percent: 12.34,
                memory_bytes: 3 * GIB,
                count: 14,
            },
            ProcessUsage {
                name: "Code".into(),
                cpu_percent: 4.06,
                memory_bytes: GIB,
                count: 6,
            },
            ProcessUsage {
                name: "muna".into(),
                cpu_percent: 0.02,
                memory_bytes: 40 * 1024 * 1024,
                count: 1,
            },
        ],
    }
}

// --- cadence ----------------------------------------------------------------------------------

#[test]
fn nothing_is_sampled_while_nobody_looks() {
    let rig = Rig::new();
    assert_eq!(
        rig.service.cadence(),
        None,
        "no panel, no strip gauge: park"
    );
    assert_eq!(rig.service.snapshot(), None);
    assert!(rig.platform.system_sample_requests().is_empty());
    assert_eq!(rig.hub.current(), StripContent::Idle);
}

#[test]
fn an_open_panel_samples_every_second_with_the_process_walk() {
    let rig = Rig::new();
    rig.platform
        .script_system_samples(vec![sample(Some(30.0), 0, 0)]);
    assert_eq!(rig.service.watch(NOTCH, true), None, "nothing read yet");
    assert_eq!(rig.service.cadence(), Some(VISIBLE_PERIOD));
    rig.service.sample();
    assert_eq!(
        rig.platform.system_sample_requests(),
        [5],
        "the default five process rows are requested while a panel watches"
    );
    rig.service.watch(NOTCH, false);
    assert_eq!(rig.service.cadence(), None);
}

#[test]
fn the_strip_gauge_alone_samples_every_ten_seconds_without_processes() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.platform
        .script_system_samples(vec![sample(Some(30.0), 0, 0)]);
    assert_eq!(rig.service.cadence(), Some(STRIP_PERIOD));
    rig.service.sample();
    assert_eq!(
        rig.platform.system_sample_requests(),
        [0],
        "the process walk is skipped while no panel is open"
    );
    let snapshot = rig.service.snapshot().expect("a reading exists");
    assert!(snapshot.processes.is_empty());
}

#[test]
fn a_panel_outranks_the_strip_cadence_and_a_destroyed_window_is_forgotten() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.service.watch(NOTCH, true);
    rig.service.watch("notch-1", true);
    assert_eq!(rig.service.cadence(), Some(VISIBLE_PERIOD));
    rig.service.watch(NOTCH, false);
    assert_eq!(
        rig.service.cadence(),
        Some(VISIBLE_PERIOD),
        "the other panel is still open"
    );
    rig.service.forget_window("notch-1");
    assert_eq!(rig.service.cadence(), Some(STRIP_PERIOD));
    rig.service.forget_window("never-seen");
    assert_eq!(rig.service.cadence(), Some(STRIP_PERIOD));
}

#[test]
fn process_rows_follow_the_setting_and_zero_skips_the_walk() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        process_count: 2,
        ..SystemMonitorSettings::default()
    });
    rig.platform
        .script_system_samples(vec![sample(Some(30.0), 0, 0)]);
    rig.service.watch(NOTCH, true);
    let snapshot = rig.service.sample().expect("a reading");
    assert_eq!(rig.platform.system_sample_requests(), [2]);
    assert_eq!(snapshot.processes.len(), 2);
    assert_eq!(snapshot.processes[0].name, "chrome");
    assert_eq!(
        snapshot.processes[0].cpu_tenths, 123,
        "12.34 % reads as 12.3 %"
    );
    assert_eq!(snapshot.processes[0].count, 14);
    assert_eq!(
        snapshot.processes[1].cpu_tenths, 41,
        "4.06 % rounds to 4.1 %"
    );

    rig.apply(&SystemMonitorSettings {
        process_count: 0,
        ..SystemMonitorSettings::default()
    });
    let snapshot = rig.service.sample().expect("a reading");
    assert_eq!(rig.platform.system_sample_requests(), [2, 0]);
    assert!(snapshot.processes.is_empty());
}

#[test]
fn a_platform_without_stats_yields_no_reading_and_no_strip() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.service.watch(NOTCH, true);
    assert_eq!(rig.service.sample(), None, "nothing scripted: unsupported");
    assert_eq!(rig.service.snapshot(), None);
    assert!(rig.recorder.snapshots.lock().is_empty());
    assert_eq!(rig.strip_activity(), None);
}

// --- derived numbers --------------------------------------------------------------------------

#[test]
fn the_first_reading_has_no_rates_and_the_second_does() {
    let rig = Rig::new();
    rig.platform.script_system_samples(vec![
        sample(None, 1_000_000, 500_000),
        sample(Some(42.4), 1_000_000 + 2_048_000, 500_000 + 512_000),
    ]);
    rig.service.watch(NOTCH, true);

    let first = rig.service.sample().expect("a reading");
    assert_eq!(first.cpu_percent, None);
    assert_eq!(first.network_down_bytes_per_s, None);
    assert_eq!(first.network_up_bytes_per_s, None);
    assert_eq!(first.logical_cpus, 8);

    let second = rig.tick(Duration::from_secs(2)).expect("a reading");
    assert_eq!(second.cpu_percent, Some(42));
    assert_eq!(second.network_down_bytes_per_s, Some(1_024_000));
    assert_eq!(second.network_up_bytes_per_s, Some(256_000));
    assert_eq!(
        rig.recorder.snapshots.lock().len(),
        2,
        "the sink hears every reading while a panel watches"
    );
}

#[test]
fn readings_across_a_long_gap_do_not_make_a_rate() {
    let rig = Rig::new();
    rig.platform.script_system_samples(vec![
        sample(Some(10.0), 0, 0),
        sample(Some(90.0), 5_000_000, 0),
        sample(Some(20.0), 5_100_000, 0),
    ]);
    rig.service.watch(NOTCH, true);
    rig.service.sample();
    let after_gap = rig
        .tick(RATE_WINDOW_MAX + Duration::from_secs(1))
        .expect("a reading");
    assert_eq!(
        after_gap.cpu_percent, None,
        "a percent averaged over a sleep or an idle stretch is not shown"
    );
    assert_eq!(after_gap.network_down_bytes_per_s, None);
    let next = rig.tick(VISIBLE_PERIOD).expect("a reading");
    assert_eq!(next.cpu_percent, Some(20));
    assert_eq!(next.network_down_bytes_per_s, Some(100_000));
}

#[test]
fn storage_sums_the_fixed_volumes_and_free_disk_is_the_system_volume() {
    let rig = Rig::new();
    rig.platform.script_system_samples(vec![sample(None, 0, 0)]);
    rig.service.watch(NOTCH, true);
    let snapshot = rig.service.sample().expect("a reading");
    assert_eq!(
        snapshot.storage_total_bytes,
        3000 * GIB,
        "C: and D:, not the USB stick"
    );
    assert_eq!(snapshot.storage_used_bytes, 750 * GIB + 500 * GIB);
    assert_eq!(snapshot.free_disk_bytes, 250 * GIB);
    assert_eq!(snapshot.system_disk_total_bytes, 1000 * GIB);
    assert_eq!(snapshot.memory_used_bytes, 9 * GIB);
    assert_eq!(snapshot.memory_total_bytes, 16 * GIB);
    assert_eq!(snapshot.battery, None, "the fake has no battery by default");
}

#[test]
fn the_battery_tile_follows_the_power_service() {
    let rig = Rig::new();
    rig.platform.set_battery(BatteryState {
        percent: Some(64),
        source: PowerSource::Ac,
        charging: true,
    });
    rig.platform.script_system_samples(vec![sample(None, 0, 0)]);
    rig.service.watch(NOTCH, true);
    let snapshot = rig.service.sample().expect("a reading");
    let battery = snapshot.battery.expect("a battery");
    assert_eq!(battery.percent, 64);
    assert!(battery.charging);
}

#[test]
fn byte_counts_saturate_at_the_safe_integer_limit() {
    let rig = Rig::new();
    let mut huge = sample(None, 0, 0);
    huge.memory_total_bytes = u64::MAX;
    huge.disks[1].total_bytes = u64::MAX;
    rig.platform.script_system_samples(vec![huge]);
    rig.service.watch(NOTCH, true);
    let snapshot = rig.service.sample().expect("a reading");
    assert_eq!(snapshot.memory_total_bytes, muna_core::Int53::MAX);
    assert_eq!(snapshot.storage_total_bytes, muna_core::Int53::MAX);
}

#[test]
fn rates_are_whole_bytes_per_second_and_saturate() {
    assert_eq!(bytes_per_second(0, Duration::from_secs(1)), 0);
    assert_eq!(bytes_per_second(1500, Duration::from_millis(1500)), 1000);
    assert_eq!(
        bytes_per_second(10, Duration::ZERO),
        10_000,
        "a zero window counts as 1 ms"
    );
    assert_eq!(bytes_per_second(u64::MAX, Duration::from_secs(1)), u32::MAX);
}

// --- strip gauge ------------------------------------------------------------------------------

#[test]
fn the_strip_gauge_is_off_by_default() {
    let rig = Rig::new();
    rig.platform
        .script_system_samples(vec![sample(Some(30.0), 0, 0), sample(Some(60.0), 0, 0)]);
    rig.service.watch(NOTCH, true);
    rig.service.sample();
    rig.tick(VISIBLE_PERIOD);
    assert_eq!(rig.strip_activity(), None);
    assert_eq!(rig.hub.current(), StripContent::Idle);
}

#[test]
fn the_strip_gauge_shows_the_whole_percent_under_every_message() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.platform.script_system_samples(vec![
        sample(None, 0, 0),
        sample(Some(30.4), 0, 0),
        sample(Some(30.2), 0, 0),
        sample(Some(31.0), 0, 0),
    ]);
    rig.service.sample();
    assert_eq!(rig.strip_activity(), None, "no percent yet");

    rig.tick(STRIP_PERIOD);
    let activity = rig.strip_activity().expect("published");
    assert_eq!(activity.priority, priority::SYSTEM_GAUGE);
    assert!(activity.priority < priority::MEDIA_PAUSED);
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Cpu,
            tint: None,
        })
    );
    assert_eq!(activity.trailing, Some(Trailing::Percent { value: 30 }));
    assert_eq!(activity.wide, None, "a gauge never bursts the wide form");
    let published = rig.recorder.strip.lock().len();

    rig.tick(STRIP_PERIOD);
    assert_eq!(
        rig.recorder.strip.lock().len(),
        published,
        "30.2 still rounds to 30: nothing republished"
    );
    rig.tick(STRIP_PERIOD);
    let activity = rig.strip_activity().expect("still published");
    assert_eq!(activity.trailing, Some(Trailing::Percent { value: 31 }));
    assert!(rig.recorder.strip.lock().len() > published);
}

#[test]
fn turning_the_strip_gauge_off_retracts_it_and_on_republishes_the_last_reading() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.platform
        .script_system_samples(vec![sample(Some(30.0), 0, 0), sample(Some(55.0), 0, 0)]);
    rig.service.sample();
    rig.tick(STRIP_PERIOD);
    assert!(rig.strip_activity().is_some());

    rig.apply(&SystemMonitorSettings::default());
    assert_eq!(rig.strip_activity(), None, "retracted at once");
    assert_eq!(rig.service.cadence(), None, "and the loop parks");

    rig.apply(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    let activity = rig
        .strip_activity()
        .expect("republished from the last reading");
    assert_eq!(activity.trailing, Some(Trailing::Percent { value: 55 }));
}

#[test]
fn a_reading_without_a_percent_retracts_the_gauge() {
    let rig = Rig::with_settings(&SystemMonitorSettings {
        show_cpu_in_strip: true,
        ..SystemMonitorSettings::default()
    });
    rig.platform.script_system_samples(vec![
        sample(Some(30.0), 0, 0),
        sample(Some(30.0), 0, 0),
        sample(None, 0, 0),
    ]);
    rig.service.sample();
    rig.tick(STRIP_PERIOD);
    assert!(rig.strip_activity().is_some());
    rig.tick(STRIP_PERIOD);
    assert_eq!(rig.strip_activity(), None);
}

// --- settings ---------------------------------------------------------------------------------

#[test]
fn settings_default_and_clamp() {
    let defaults = SystemMonitorSettings::default();
    assert!(!defaults.show_cpu_in_strip);
    assert_eq!(defaults.process_count, 5);

    let mut document = Settings::default();
    document.modules.insert(
        "system-monitor".into(),
        serde_json::json!({ "showCpuInStrip": true, "processCount": 99, "future": 1 }),
    );
    let read = SystemMonitorSettings::from_document(&document);
    assert!(read.show_cpu_in_strip);
    assert_eq!(read.process_count, 10, "clamped to the upper bound");

    document
        .modules
        .insert("system-monitor".into(), serde_json::json!("not an object"));
    assert_eq!(
        SystemMonitorSettings::from_document(&document),
        SystemMonitorSettings::default(),
        "malformed falls back to defaults"
    );
}
