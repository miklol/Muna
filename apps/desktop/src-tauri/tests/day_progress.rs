//! The `day-progress` module against `FakeClock` and a fixed zone
//! (docs/modules/day-progress.md, docs/build-plan/m3-daily-modules.md E6). Integration tests
//! because the `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked
//! tests).

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, Settings, StripContent, StripSink, Trailing,
    activities::priority,
};
use muna_lib::modules::day_progress::{
    BAR_ACTIVITY_ID, DayProgressService, DayProgressSettings, FixedZone, ID, Plan, SECONDS_PER_DAY,
    bar_activity, plan, seconds_of_day,
    settings::{LAST_MINUTE, MIN_WORKING_MINUTES},
};
use parking_lot::Mutex;

/// A midnight, UTC (a whole number of days since the epoch), so `FixedZone(0)` puts the fake
/// clock at 00:00 local wherever the test runs.
const MIDNIGHT_UNIX: u64 = 20_513 * 86_400;

const HOUR: Duration = Duration::from_secs(3600);

#[derive(Default)]
struct Recorder {
    strip: Mutex<Vec<StripContent>>,
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    hub: Arc<Hub>,
    service: Arc<DayProgressService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    /// Starts at `hour` o'clock local time with `settings` applied.
    fn at(hour: u64, settings: &DayProgressSettings) -> Self {
        Self::at_offset(hour, 0, settings)
    }

    fn at_offset(hour: u64, offset_seconds: i32, settings: &DayProgressSettings) -> Self {
        // The zone shifts what "local" reads (local = wall + offset), so the wall clock starts
        // `offset` before the asked local hour.
        let local = i64::try_from(MIDNIGHT_UNIX + hour * 3600).expect("fits");
        let wall = u64::try_from(local - i64::from(offset_seconds)).expect("after the epoch");
        let clock = Arc::new(FakeClock::at(UNIX_EPOCH + Duration::from_secs(wall)));
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let recorder = Arc::new(Recorder::default());
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        let service = Arc::new(DayProgressService::new(
            Arc::clone(&hub),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::new(FixedZone(offset_seconds)),
        ));
        let rig = Self {
            clock,
            hub,
            service,
            recorder,
        };
        rig.apply(settings);
        rig
    }

    fn apply(&self, settings: &DayProgressSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    /// What the backend loop does: let time pass, then look at the clock again.
    fn tick(&self, by: Duration) -> Option<Duration> {
        self.clock.advance(by);
        self.service.update()
    }

    fn strip(&self) -> StripContent {
        self.hub.current()
    }

    fn published(&self) -> usize {
        self.recorder.strip.lock().len()
    }
}

fn bar_on() -> DayProgressSettings {
    DayProgressSettings {
        show_day_in_strip: true,
        ..DayProgressSettings::default()
    }
}

/// The percent of the bar the strip shows, if it shows one.
fn shown_percent(content: &StripContent) -> Option<u8> {
    match content {
        StripContent::Activity { activity, .. } if activity.id == BAR_ACTIVITY_ID => {
            match activity.trailing {
                Some(Trailing::Progress { percent }) => Some(percent),
                _ => None,
            }
        }
        _ => None,
    }
}

#[test]
fn off_by_default_the_module_publishes_nothing_and_parks() {
    let rig = Rig::at(10, &DayProgressSettings::default());
    assert_eq!(rig.service.update(), None);
    assert_eq!(rig.strip(), StripContent::Idle);
    assert!(rig.hub.activities().is_empty());
    assert_eq!(rig.service.showing(), None);
}

#[test]
fn the_bar_waits_for_the_working_day_and_then_follows_it() {
    let rig = Rig::at(8, &bar_on());
    // 08:00: an hour before the default 09:00 start, nothing shows yet.
    assert_eq!(rig.service.update(), Some(HOUR));
    assert_eq!(rig.strip(), StripContent::Idle);

    // 09:00: the bar appears at 0 %.
    assert_eq!(rig.tick(HOUR), Some(Duration::from_secs(324)));
    assert_eq!(shown_percent(&rig.strip()), Some(0));
    assert_eq!(rig.service.showing(), Some(0));

    // 13:30: halfway through the nine hours.
    rig.tick(HOUR * 4 + Duration::from_mins(30));
    assert_eq!(shown_percent(&rig.strip()), Some(50));
}

#[test]
fn the_bar_is_republished_only_when_the_whole_percent_moves() {
    let rig = Rig::at(9, &bar_on());
    rig.service.update();
    let after_start = rig.published();
    assert_eq!(shown_percent(&rig.strip()), Some(0));

    // A 9 h day moves one percent every 324 s; 100 s in, the strip is untouched.
    let wait = rig
        .tick(Duration::from_secs(100))
        .expect("inside the window");
    assert_eq!(wait, Duration::from_secs(224));
    assert_eq!(rig.published(), after_start);

    // At the boundary the next percent goes out, once.
    rig.tick(wait);
    assert_eq!(shown_percent(&rig.strip()), Some(1));
    assert_eq!(rig.published(), after_start + 1);
}

#[test]
fn the_bar_is_retracted_at_the_end_of_the_day_until_the_next_start() {
    let rig = Rig::at(17, &bar_on());
    rig.service.update();
    assert!(shown_percent(&rig.strip()).is_some());

    // 18:00: the day is over; the next look is tomorrow at 09:00, fifteen hours away.
    assert_eq!(rig.tick(HOUR), Some(HOUR * 15));
    assert_eq!(rig.strip(), StripContent::Idle);
    assert_eq!(rig.service.showing(), None);
    assert!(rig.hub.activities().is_empty());
}

#[test]
fn turning_the_bar_off_retracts_it_at_once_and_on_again_shows_it() {
    let rig = Rig::at(12, &bar_on());
    rig.service.update();
    assert!(shown_percent(&rig.strip()).is_some());

    rig.apply(&DayProgressSettings::default());
    assert_eq!(rig.strip(), StripContent::Idle);
    assert_eq!(rig.service.update(), None);

    rig.apply(&bar_on());
    assert_eq!(shown_percent(&rig.strip()), Some(33));
}

#[test]
fn new_working_hours_move_the_bar_without_waiting_for_the_loop() {
    let rig = Rig::at(12, &bar_on());
    rig.service.update();
    assert_eq!(shown_percent(&rig.strip()), Some(33));

    // 08:00–16:00: noon is halfway.
    rig.apply(&DayProgressSettings {
        work_start_minutes: 8 * 60,
        work_end_minutes: 16 * 60,
        ..bar_on()
    });
    assert_eq!(shown_percent(&rig.strip()), Some(50));

    // 13:00–14:00: noon is before the start.
    rig.apply(&DayProgressSettings {
        work_start_minutes: 13 * 60,
        work_end_minutes: 14 * 60,
        ..bar_on()
    });
    assert_eq!(rig.strip(), StripContent::Idle);
    assert_eq!(rig.service.update(), Some(HOUR));
}

#[test]
fn the_zone_offset_decides_what_local_means() {
    // Wall clock 10:00 UTC; the zone is two hours east, so local time reads 12:00.
    let rig = Rig::at_offset(12, 2 * 3600, &bar_on());
    rig.service.update();
    assert_eq!(shown_percent(&rig.strip()), Some(33));
    assert_eq!(
        seconds_of_day(rig.clock.system_time(), 2 * 3600),
        12 * 3600,
        "the rig lands on the asked local hour"
    );
    assert_eq!(seconds_of_day(rig.clock.system_time(), 0), 10 * 3600);
}

#[test]
fn seconds_of_day_wraps_negative_offsets_and_the_epoch() {
    let midnight = UNIX_EPOCH + Duration::from_secs(MIDNIGHT_UNIX);
    assert_eq!(seconds_of_day(midnight, 0), 0);
    assert_eq!(seconds_of_day(midnight, -3600), SECONDS_PER_DAY - 3600);
    assert_eq!(seconds_of_day(midnight + HOUR, 3600), 2 * 3600);
    assert_eq!(
        seconds_of_day(UNIX_EPOCH - HOUR, 0),
        0,
        "before the epoch reads as midnight"
    );
    assert_eq!(
        seconds_of_day(UNIX_EPOCH, 25 * 3600),
        3600,
        "a wild offset still wraps"
    );
}

#[test]
fn plan_stays_below_one_hundred_and_lands_exactly_on_the_end() {
    let settings = bar_on();
    let start = 9 * 3600;
    let end = 18 * 3600;
    let Plan {
        percent,
        next_change,
    } = plan(&settings, end - 1);
    assert_eq!(percent, Some(99));
    assert_eq!(next_change, Some(Duration::from_secs(1)));
    assert_eq!(plan(&settings, start).percent, Some(0));
    assert_eq!(
        plan(&settings, end),
        Plan {
            percent: None,
            next_change: Some(Duration::from_secs(u64::from(
                SECONDS_PER_DAY - end + start
            ))),
        }
    );
    // A reading past the last second of the day is treated as that second.
    assert_eq!(
        plan(&settings, SECONDS_PER_DAY + 5),
        plan(&settings, SECONDS_PER_DAY - 1)
    );
    // Every second inside the window has a strictly positive wait, so the loop never spins.
    for now in (start..end).step_by(7) {
        let plan = plan(&settings, now);
        assert!(plan.percent.is_some_and(|p| p < 100));
        assert!(
            plan.next_change
                .is_some_and(|wait| wait >= Duration::from_secs(1))
        );
    }
}

#[test]
fn malformed_and_backwards_settings_fall_back_to_a_valid_day() {
    let mut document = Settings::default();
    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "workStartMinutes": "nine", "showDayInStrip": true }),
    );
    assert_eq!(
        DayProgressSettings::from_document(&document),
        DayProgressSettings::default(),
        "a wrong type fails the whole entry"
    );

    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "workStartMinutes": 600, "workEndMinutes": 500, "bedtimeMinutes": 5000 }),
    );
    let repaired = DayProgressSettings::from_document(&document);
    assert_eq!(repaired.work_start_minutes, 600);
    assert_eq!(repaired.work_end_minutes, 600 + MIN_WORKING_MINUTES);
    assert_eq!(repaired.bedtime_minutes, Some(LAST_MINUTE));
    assert!(repaired.show_tasks, "missing fields take their defaults");

    document.modules.insert(
        ID.to_owned(),
        serde_json::json!({ "workStartMinutes": 2000, "workEndMinutes": 100 }),
    );
    let defaults = DayProgressSettings::from_document(&document);
    assert_eq!(
        defaults.work_start_minutes,
        9 * 60,
        "an unrepairable window is the default one"
    );
    assert_eq!(defaults.work_end_minutes, 18 * 60);

    document.modules.remove(ID);
    assert_eq!(
        DayProgressSettings::from_document(&document),
        DayProgressSettings::default()
    );
}

#[test]
fn the_bar_activity_is_the_most_ambient_content_and_never_bursts() {
    let activity = bar_activity(150);
    assert_eq!(activity.id, BAR_ACTIVITY_ID);
    assert_eq!(activity.module, ID);
    assert_eq!(activity.priority, priority::DAY_PROGRESS);
    const { assert!(priority::DAY_PROGRESS < priority::SYSTEM_GAUGE) };
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Hourglass,
            tint: None,
        })
    );
    assert_eq!(activity.trailing, Some(Trailing::Progress { percent: 100 }));
    assert_eq!(activity.wide, None);
}

#[test]
fn the_bar_yields_to_every_other_activity() {
    let rig = Rig::at(12, &bar_on());
    rig.service.update();
    assert!(shown_percent(&rig.strip()).is_some());

    rig.hub
        .publish_activity(muna_lib::modules::system_monitor::cpu_activity(40));
    match rig.strip() {
        StripContent::Activity { activity, .. } => {
            assert_eq!(activity.id, "system-monitor:cpu");
        }
        other => panic!("expected the CPU gauge on top, got {other:?}"),
    }
    rig.hub.retract_activity("system-monitor:cpu");
    assert_eq!(shown_percent(&rig.strip()), Some(33));
}

#[test]
fn a_fixed_zone_reports_the_same_offset_at_any_instant() {
    use muna_lib::modules::day_progress::Zone;
    let zone = FixedZone(-5 * 3600);
    assert_eq!(zone.offset_seconds(UNIX_EPOCH), -5 * 3600);
    assert_eq!(zone.offset_seconds(SystemTime::now()), -5 * 3600);
}
