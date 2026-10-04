//! The `health` module against `FakePlatform`, `FakeClock` and an in-memory store
//! (docs/modules/health.md acceptance criteria, docs/build-plan/m5-ship.md E1b). Integration
//! tests because the `muna` lib cannot host unit tests (Common Controls manifest on
//! Tauri-linked tests).

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use muna_core::activities::priority;
use muna_core::{
    Clock, FakeClock, Glyph, HealthFlow, Hub, Leading, Settings, Store, StripContent, StripMessage,
    StripSink, Trailing,
};
use muna_lib::modules::health::{
    BREAK_NOTICE_HOLD, BREAK_NOTICE_ID, BreathePattern, FLOW_ACTIVITY_ID, FLOW_FINISHED_NOTICE_ID,
    FixedZone, HEARING_NOTICE_ID, HealthCommand, HealthService, HealthSettings, HealthSink,
    HealthSnapshot, SittingStatus, TICK, WEEK_DAYS,
    settings::{BREAK_EVERY_MINUTES, WATER_GOAL, WIND_DOWN_HOUR},
    tracker::{
        DAY_MS, DEFER_MS, LOUD_AFTER_MS, MINDFUL_GOAL_SECONDS, MINUTE_MS, SNOOZE_MS, flow_total_ms,
    },
};
use muna_platform::{
    BluetoothDevice, BluetoothDeviceKind, FakePlatform, Platform, PlatformEvent,
    UserNotificationState,
};
use parking_lot::Mutex;

const MINUTE: Duration = Duration::from_secs(60);
/// 2026-03-04 06:00 UTC; the rig's zone is UTC, so the local day starts at 00:00 UTC and a
/// test has eighteen hours before midnight.
const WALL_ORIGIN_SECS: u64 = 1_772_604_000;
const ORIGIN_MS: i64 = 1_772_604_000_000;
const DAY_START_MS: i64 = ORIGIN_MS - 6 * 60 * MINUTE_MS;

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<HealthSnapshot>>,
    strip: Mutex<Vec<StripContent>>,
}

impl HealthSink for Recorder {
    fn changed(&self, snapshot: &HealthSnapshot) {
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
    store: Arc<Store>,
    service: Arc<HealthService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_settings(&HealthSettings::default())
    }

    fn with_settings(settings: &HealthSettings) -> Self {
        Self::build(settings, |_| {})
    }

    /// `script` runs against the platform before the service primes itself.
    fn build(settings: &HealthSettings, script: impl FnOnce(&FakePlatform)) -> Self {
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_secs(WALL_ORIGIN_SECS),
        ));
        let platform = Arc::new(FakePlatform::new());
        script(&platform);
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let store = Arc::new(Store::open_in_memory().expect("in-memory store"));
        let service = Arc::new(HealthService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::new(FixedZone(0)),
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn HealthSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        service.apply_settings(&document);
        service.prime();
        Self {
            clock,
            platform,
            hub,
            store,
            service,
            recorder,
        }
    }

    /// Lets `by` pass the way the backend loop would see it: one tick per [`TICK`].
    fn run_for(&self, by: Duration) {
        let mut left = by;
        while !left.is_zero() {
            let step = left.min(TICK);
            self.clock.advance(step);
            left -= step;
            self.service.tick();
        }
    }

    fn now_ms(&self) -> i64 {
        i64::try_from(
            self.clock
                .system_time()
                .duration_since(UNIX_EPOCH)
                .expect("after the epoch")
                .as_millis(),
        )
        .expect("fits")
    }

    fn snapshot(&self) -> HealthSnapshot {
        self.service.snapshot()
    }

    fn command(&self, command: HealthCommand) -> HealthSnapshot {
        self.service.command(command)
    }

    fn apply(&self, settings: &HealthSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    fn lock(&self, locked: bool) {
        self.service
            .handle_event(&PlatformEvent::SessionLockChanged { locked });
    }

    fn volume(&self, percent: u8, muted: bool) {
        self.platform.set_volume_state(percent, muted);
        self.service
            .handle_event(&PlatformEvent::VolumeChanged { percent, muted });
    }

    fn bluetooth(&self, device: BluetoothDevice) {
        self.platform.set_bluetooth_device(device.clone());
        self.service
            .handle_event(&PlatformEvent::BluetoothChanged(device));
    }

    fn flow_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|held| held.activity)
            .find(|activity| activity.id == FLOW_ACTIVITY_ID)
    }

    fn shown_notice(&self) -> Option<muna_core::Notice> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice),
            _ => None,
        }
    }

    /// Every notice the strip showed so far, in order.
    fn notices(&self) -> Vec<muna_core::Notice> {
        self.recorder
            .strip
            .lock()
            .iter()
            .filter_map(|content| match content {
                StripContent::Notice { notice } => Some(notice.clone()),
                _ => None,
            })
            .collect()
    }
}

fn headphones(id: &str, name: &str, connected: bool) -> BluetoothDevice {
    BluetoothDevice {
        id: id.to_owned(),
        name: name.to_owned(),
        connected,
        battery_percent: Some(80),
        kind: BluetoothDeviceKind::Headphones,
    }
}

fn ms(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).expect("fits")
}

fn minutes(count: i64) -> Duration {
    Duration::from_millis(u64::try_from(count * MINUTE_MS).expect("positive"))
}

// --- the sit ---------------------------------------------------------------------------------

#[test]
fn the_sit_starts_when_the_module_primes() {
    let rig = Rig::new();
    let snapshot = rig.snapshot();
    assert!(snapshot.enabled);
    assert_eq!(snapshot.sitting, SittingStatus::Sitting);
    assert_eq!(snapshot.sitting_since_ms, Some(ORIGIN_MS));
    assert_eq!(snapshot.sitting_ms, 0);
    assert_eq!(snapshot.next_break_in_ms, Some(ms(minutes(50))));
    assert_eq!(snapshot.break_due_since_ms, None);
    assert_eq!(
        snapshot.today,
        muna_lib::modules::health::HealthDay::default()
    );
    assert_eq!(snapshot.goals.breaks, 7, "6 h / 50 min, rounded down");
    assert_eq!(snapshot.goals.water, 8);
    assert_eq!(snapshot.goals.mindful_seconds, MINDFUL_GOAL_SECONDS);
    assert_eq!(snapshot.week.len(), WEEK_DAYS);
    assert_eq!(
        snapshot.week.last().map(|day| day.day_start_ms),
        Some(DAY_START_MS),
        "today is the last dot"
    );
    assert_eq!(snapshot.streak_days, 0);
    assert_eq!(snapshot.flow, None);
    assert_eq!(snapshot.hearing, None);
    assert!(!snapshot.winding_down);
    assert_eq!(snapshot.day_start_ms, DAY_START_MS);
    assert_eq!(
        rig.recorder.snapshots.lock().len(),
        1,
        "priming publishes once"
    );
    assert!(
        rig.hub.activities().is_empty(),
        "no strip content while sitting"
    );
}

#[test]
fn the_sit_counts_up_and_credits_active_time() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.sitting_ms, ms(minutes(20)));
    assert_eq!(snapshot.today.active_ms, ms(minutes(20)));
    assert_eq!(snapshot.today.longest_sit_ms, ms(minutes(20)));
    assert_eq!(snapshot.next_break_in_ms, Some(ms(minutes(30))));
    let stored = rig
        .store
        .health_day(DAY_START_MS)
        .expect("store reads")
        .expect("today is saved while sitting");
    assert!(
        stored.active_ms >= 15 * MINUTE_MS,
        "credited at least every five minutes, got {}",
        stored.active_ms
    );
}

#[test]
fn stepping_away_ends_a_long_sit_and_counts_a_break() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    rig.platform.set_idle_for(minutes(3));
    rig.run_for(TICK);
    let away = rig.snapshot();
    assert_eq!(away.sitting, SittingStatus::Away);
    assert_eq!(away.sitting_since_ms, None);
    assert_eq!(away.next_break_in_ms, None);
    assert_eq!(
        away.sitting_ms,
        ms(minutes(17)) + ms(TICK),
        "frozen at the moment input stopped"
    );

    rig.platform.set_idle_for(Duration::from_secs(5));
    rig.run_for(TICK);
    let back = rig.snapshot();
    assert_eq!(back.sitting, SittingStatus::Sitting);
    assert_eq!(back.today.breaks, 1, "a 17 min sit followed by a break");
    assert_eq!(back.today.longest_sit_ms, ms(minutes(17)) + ms(TICK));
    assert_eq!(
        back.sitting_since_ms,
        Some(rig.now_ms() - 5_000),
        "the new sit starts when input resumed"
    );
    assert_eq!(back.next_break_in_ms, Some(ms(minutes(50)) - 5_000));
}

#[test]
fn a_short_sit_is_no_break() {
    let rig = Rig::new();
    rig.run_for(minutes(5));
    rig.platform.set_idle_for(minutes(3));
    rig.run_for(TICK);
    rig.platform.set_idle_for(Duration::ZERO);
    rig.run_for(TICK);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.sitting, SittingStatus::Sitting);
    assert_eq!(snapshot.today.breaks, 0);
}

#[test]
fn a_short_lock_is_skipped_and_a_long_one_is_a_break() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    rig.lock(true);
    let locked = rig.snapshot();
    assert_eq!(locked.sitting, SittingStatus::Locked);
    assert_eq!(
        rig.service.next_wake(),
        None,
        "nothing to poll while locked"
    );

    rig.clock.advance(MINUTE);
    rig.lock(false);
    let back = rig.snapshot();
    assert_eq!(back.sitting, SittingStatus::Sitting);
    assert_eq!(back.today.breaks, 0, "a minute at the door is not a break");
    assert_eq!(
        back.sitting_since_ms,
        Some(ORIGIN_MS + MINUTE_MS),
        "the sit continues as if the minute never happened"
    );
    assert_eq!(back.next_break_in_ms, Some(ms(minutes(30))));

    rig.lock(true);
    rig.clock.advance(minutes(10));
    rig.lock(false);
    let after = rig.snapshot();
    assert_eq!(after.today.breaks, 1);
    assert_eq!(after.sitting_since_ms, Some(rig.now_ms()));
    assert_eq!(after.today.longest_sit_ms, ms(minutes(20)));
}

#[test]
fn sleeping_through_ticks_ends_the_sit() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    rig.clock.advance(minutes(30));
    rig.service.tick();
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.sitting, SittingStatus::Sitting);
    assert_eq!(snapshot.today.breaks, 1, "the sit ended at the last tick");
    assert_eq!(snapshot.today.longest_sit_ms, ms(minutes(20)));
    assert_eq!(
        snapshot.today.active_ms,
        ms(minutes(20)),
        "sleep is not desk time"
    );
    assert_eq!(snapshot.sitting_since_ms, Some(rig.now_ms()));
}

// --- the reminder ----------------------------------------------------------------------------

#[test]
fn the_reminder_fires_after_the_interval() {
    let rig = Rig::new();
    rig.run_for(minutes(49));
    assert!(rig.shown_notice().is_none());
    rig.run_for(MINUTE);
    let notice = rig
        .shown_notice()
        .expect("the break notice holds the strip");
    assert_eq!(notice.id, BREAK_NOTICE_ID);
    assert_eq!(notice.module, "health");
    assert_eq!(notice.priority, priority::HEALTH);
    assert_eq!(notice.wide, Some(StripMessage::HealthBreak { minutes: 50 }));
    assert!(matches!(
        notice.leading,
        Some(Leading::Icon {
            glyph: Glyph::Heart,
            ..
        })
    ));
    assert_eq!(notice.hold(), BREAK_NOTICE_HOLD);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.break_due_since_ms, Some(rig.now_ms()));
    assert_eq!(
        snapshot.next_break_in_ms, None,
        "no countdown while one is up"
    );

    rig.run_for(minutes(50));
    assert_eq!(
        rig.notices().len(),
        1,
        "an unanswered reminder does not nag"
    );
}

#[test]
fn snooze_asks_again_in_ten_minutes() {
    let rig = Rig::new();
    rig.run_for(minutes(50));
    let snapshot = rig.command(HealthCommand::Snooze);
    assert_eq!(snapshot.break_due_since_ms, None);
    assert_eq!(snapshot.next_break_in_ms, Some(ms(minutes(10))));
    rig.run_for(Duration::from_millis(
        u64::try_from(SNOOZE_MS).expect("positive"),
    ));
    assert_eq!(rig.notices().len(), 2);
    assert_eq!(
        rig.snapshot().break_due_since_ms,
        Some(rig.now_ms()),
        "due again"
    );
}

#[test]
fn dismiss_waits_a_full_interval() {
    let rig = Rig::new();
    rig.run_for(minutes(50));
    let snapshot = rig.command(HealthCommand::Dismiss);
    assert_eq!(snapshot.break_due_since_ms, None);
    assert_eq!(snapshot.next_break_in_ms, Some(ms(minutes(50))));
    assert_eq!(
        rig.command(HealthCommand::Dismiss).next_break_in_ms,
        Some(ms(minutes(50))),
        "dismissing nothing changes nothing"
    );
}

#[test]
fn getting_up_answers_the_reminder() {
    let rig = Rig::new();
    rig.run_for(minutes(50));
    assert!(rig.snapshot().break_due_since_ms.is_some());
    rig.platform.set_idle_for(minutes(3));
    rig.run_for(TICK);
    assert_eq!(rig.snapshot().break_due_since_ms, None);
    rig.platform.set_idle_for(Duration::ZERO);
    rig.run_for(TICK);
    let back = rig.snapshot();
    assert_eq!(back.today.breaks, 1);
    assert_eq!(back.next_break_in_ms, Some(ms(minutes(50))));
}

#[test]
fn the_reminder_waits_while_presenting() {
    let rig = Rig::new();
    rig.platform
        .set_user_notification_state(UserNotificationState::Presentation);
    rig.run_for(minutes(50));
    assert!(rig.shown_notice().is_none(), "no nudge over a presentation");
    let deferred = rig.snapshot();
    assert_eq!(deferred.break_due_since_ms, None);
    assert_eq!(
        deferred.next_break_in_ms,
        Some(u32::try_from(DEFER_MS).expect("fits")),
        "tries again in five minutes"
    );
    rig.run_for(minutes(5));
    assert!(rig.shown_notice().is_none());

    rig.platform
        .set_user_notification_state(UserNotificationState::AcceptsNotifications);
    rig.run_for(minutes(5));
    let notice = rig.shown_notice().expect("the reminder catches up");
    assert_eq!(notice.wide, Some(StripMessage::HealthBreak { minutes: 60 }));
}

#[test]
fn changing_the_interval_reschedules_the_open_sit() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    rig.apply(&HealthSettings {
        break_every_min: 30,
        ..HealthSettings::default()
    });
    let snapshot = rig.snapshot();
    assert_eq!(
        snapshot.next_break_in_ms,
        Some(ms(minutes(10))),
        "30 min from the sit's start"
    );
    assert_eq!(snapshot.goals.breaks, 12);
    assert!(rig.service.next_wake().is_some_and(|wake| wake <= TICK));
}

// --- flows -----------------------------------------------------------------------------------

#[test]
fn a_move_flow_counts_a_break_and_restarts_the_sit() {
    let rig = Rig::new();
    rig.run_for(minutes(30));
    let started = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Move,
    });
    let flow = started.flow.expect("the flow runs");
    assert_eq!(flow.flow, HealthFlow::Move);
    assert_eq!(flow.started_ms, rig.now_ms());
    assert_eq!(flow.total_ms, 180_000);
    assert_eq!(flow.remaining_ms, 180_000);
    assert_eq!(flow.pattern, BreathePattern::Box);
    assert_eq!(started.next_break_in_ms, None, "no countdown during a flow");

    let activity = rig.flow_activity().expect("the countdown is on the strip");
    assert_eq!(activity.module, "health");
    assert_eq!(activity.priority, priority::HEALTH_FLOW);
    assert!(matches!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Timer,
            ..
        })
    ));
    assert_eq!(
        activity.trailing,
        Some(Trailing::Timer {
            remaining_ms: 180_000,
            total_ms: 180_000,
            running: true,
        })
    );
    assert_eq!(
        activity.wide,
        Some(StripMessage::HealthFlow {
            flow: HealthFlow::Move,
        })
    );

    rig.run_for(minutes(3));
    let finished = rig.snapshot();
    assert_eq!(finished.flow, None);
    assert!(rig.flow_activity().is_none(), "the countdown is retracted");
    assert_eq!(finished.today.flows, 1);
    assert_eq!(finished.today.breaks, 1, "moving is a break");
    assert_eq!(finished.today.mindful_seconds, 0);
    assert_eq!(finished.today.longest_sit_ms, ms(minutes(30)));
    assert_eq!(
        finished.sitting_since_ms,
        Some(rig.now_ms()),
        "a fresh sit starts when the flow ends"
    );
    let notice = rig.shown_notice().expect("the finished notice");
    assert_eq!(notice.id, FLOW_FINISHED_NOTICE_ID);
    assert_eq!(
        notice.wide,
        Some(StripMessage::HealthFlowFinished {
            flow: HealthFlow::Move,
        })
    );
}

#[test]
fn breathing_fills_the_mindful_ring() {
    let rig = Rig::new();
    let started = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Breathe,
    });
    let total = flow_total_ms(HealthFlow::Breathe, BreathePattern::Box);
    assert_eq!(total, 128_000, "eight 16 s box cycles");
    assert_eq!(started.flow.map(|flow| flow.total_ms), Some(total));
    rig.run_for(Duration::from_millis(u64::from(total)));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.flow, None);
    assert_eq!(snapshot.today.mindful_seconds, 128);
    assert_eq!(snapshot.today.flows, 1);
    assert_eq!(snapshot.today.breaks, 0, "breathing is not a break");
    assert_eq!(
        snapshot.sitting_since_ms,
        Some(ORIGIN_MS),
        "the sit goes on"
    );
}

#[test]
fn the_relax_pattern_changes_the_breathe_length() {
    let rig = Rig::with_settings(&HealthSettings {
        breathe_pattern: BreathePattern::Relax,
        ..HealthSettings::default()
    });
    let started = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Breathe,
    });
    let flow = started.flow.expect("runs");
    assert_eq!(flow.total_ms, 6 * 19_000);
    assert_eq!(flow.pattern, BreathePattern::Relax);
}

#[test]
fn stopping_a_breathe_flow_keeps_the_seconds_done() {
    let rig = Rig::new();
    rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Breathe,
    });
    rig.run_for(MINUTE);
    let stopped = rig.command(HealthCommand::StopFlow);
    assert_eq!(stopped.flow, None);
    assert_eq!(stopped.today.mindful_seconds, 60);
    assert_eq!(stopped.today.flows, 0, "not finished");
    assert!(rig.flow_activity().is_none());
    assert!(rig.shown_notice().is_none(), "no finished notice");
}

#[test]
fn a_flow_answers_the_reminder_and_survives_idle() {
    let rig = Rig::new();
    rig.run_for(minutes(50));
    assert!(rig.snapshot().break_due_since_ms.is_some());
    let started = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Stretch,
    });
    assert_eq!(started.break_due_since_ms, None);
    assert_eq!(started.flow.map(|flow| flow.total_ms), Some(120_000));

    // Stretching is time away from the keyboard: idle does not end the sit meanwhile.
    rig.platform.set_idle_for(minutes(3));
    rig.run_for(MINUTE);
    let midway = rig.snapshot();
    assert_eq!(midway.sitting, SittingStatus::Sitting);
    assert_eq!(midway.flow.map(|flow| flow.remaining_ms), Some(60_000));

    rig.platform.set_idle_for(Duration::ZERO);
    rig.run_for(MINUTE);
    let done = rig.snapshot();
    assert_eq!(done.flow, None);
    assert_eq!(done.today.breaks, 1);
    assert_eq!(done.today.flows, 1);
}

#[test]
fn eye_rest_is_twenty_seconds() {
    let rig = Rig::new();
    let started = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::EyeRest,
    });
    assert_eq!(started.flow.map(|flow| flow.total_ms), Some(20_000));
    rig.run_for(TICK);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.flow, None);
    assert_eq!(snapshot.today.flows, 1);
    assert_eq!(snapshot.today.breaks, 0);
}

#[test]
fn starting_a_flow_replaces_the_running_one() {
    let rig = Rig::new();
    rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Move,
    });
    let replaced = rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Breathe,
    });
    assert_eq!(
        replaced.flow.map(|flow| flow.flow),
        Some(HealthFlow::Breathe)
    );
    let activities = rig.hub.activities();
    assert_eq!(activities.len(), 1, "one countdown at a time");
    assert_eq!(
        activities[0].activity.wide,
        Some(StripMessage::HealthFlow {
            flow: HealthFlow::Breathe,
        })
    );
}

#[test]
fn locking_stops_a_flow() {
    let rig = Rig::new();
    rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Move,
    });
    rig.lock(true);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.flow, None);
    assert_eq!(snapshot.sitting, SittingStatus::Locked);
    assert!(rig.flow_activity().is_none());
    assert_eq!(snapshot.today.flows, 0);
}

// --- water, reset, history -------------------------------------------------------------------

#[test]
fn water_logs_and_clamps() {
    let rig = Rig::new();
    assert_eq!(
        rig.command(HealthCommand::Water { delta: 3 }).today.water,
        3
    );
    assert_eq!(
        rig.command(HealthCommand::Water { delta: -1 }).today.water,
        2
    );
    assert_eq!(
        rig.command(HealthCommand::Water { delta: -5 }).today.water,
        0,
        "never negative"
    );
    assert_eq!(
        rig.command(HealthCommand::Water { delta: 200 }).today.water,
        99
    );
    let stored = rig
        .store
        .health_day(DAY_START_MS)
        .expect("reads")
        .expect("saved");
    assert_eq!(stored.water, 99, "saved at once");
}

#[test]
fn reset_zeroes_today_and_restarts_the_sit() {
    let rig = Rig::new();
    rig.command(HealthCommand::Water { delta: 4 });
    rig.run_for(minutes(30));
    let snapshot = rig.command(HealthCommand::Reset);
    assert_eq!(
        snapshot.today,
        muna_lib::modules::health::HealthDay::default()
    );
    assert_eq!(snapshot.sitting_since_ms, Some(rig.now_ms()));
    assert_eq!(snapshot.next_break_in_ms, Some(ms(minutes(50))));
    let stored = rig
        .store
        .health_day(DAY_START_MS)
        .expect("reads")
        .expect("saved");
    assert_eq!(stored.water, 0);
    assert_eq!(stored.active_ms, 0);
}

#[test]
fn midnight_closes_yesterday_and_keeps_the_sit() {
    let rig = Rig::new();
    rig.command(HealthCommand::Water { delta: 8 });
    rig.run_for(minutes(18 * 60 + 1));
    let snapshot = rig.snapshot();
    let today_start = DAY_START_MS + DAY_MS;
    assert_eq!(snapshot.day_start_ms, today_start);
    assert_eq!(snapshot.today.water, 0, "a new day");
    assert_eq!(snapshot.today.active_ms, ms(MINUTE));
    assert_eq!(
        snapshot.sitting_since_ms,
        Some(ORIGIN_MS),
        "the open sit carries on"
    );
    let yesterday = rig
        .store
        .health_day(DAY_START_MS)
        .expect("reads")
        .expect("yesterday is saved");
    assert_eq!(yesterday.water, 8);
    assert_eq!(yesterday.active_ms, 18 * 60 * MINUTE_MS, "up to midnight");
    let dots = &snapshot.week;
    assert_eq!(dots.len(), WEEK_DAYS);
    assert_eq!(dots[WEEK_DAYS - 1].day_start_ms, today_start);
    assert_eq!(dots[WEEK_DAYS - 2].day_start_ms, DAY_START_MS);
    assert_eq!(dots[WEEK_DAYS - 2].water, 8);
    assert_eq!(
        dots[WEEK_DAYS - 2].goals_met,
        1,
        "water met, breaks and mindful not"
    );
    assert_eq!(dots[WEEK_DAYS - 3].goals_met, 0);
    assert_eq!(
        snapshot.streak_days, 1,
        "yesterday counts until today is over"
    );
}

#[test]
fn clear_history_forgets_every_day() {
    let rig = Rig::new();
    rig.command(HealthCommand::Water { delta: 8 });
    rig.run_for(minutes(18 * 60 + 1));
    assert_eq!(rig.snapshot().streak_days, 1);
    let cleared = rig.command(HealthCommand::ClearHistory);
    assert_eq!(cleared.streak_days, 0);
    assert!(
        cleared
            .week
            .iter()
            .all(|day| day.goals_met == 0 && day.water == 0)
    );
    assert_eq!(
        rig.store.health_day(DAY_START_MS).expect("reads"),
        None,
        "yesterday is gone"
    );
}

// --- hearing ---------------------------------------------------------------------------------

#[test]
fn loud_headphones_warn_after_ten_minutes() {
    let rig = Rig::build(&HealthSettings::default(), |platform| {
        platform.set_bluetooth_device(headphones("bt-1", "WH-1000XM4", true));
    });
    assert_eq!(rig.snapshot().hearing, None, "quiet so far");
    rig.volume(90, false);
    let loud = rig.snapshot().hearing.expect("the clock runs");
    assert_eq!(loud.percent, 90);
    assert_eq!(loud.loud_for_ms, 0);
    assert!(!loud.warned);

    rig.run_for(Duration::from_millis(
        u64::try_from(LOUD_AFTER_MS).expect("positive"),
    ));
    let notice = rig.shown_notice().expect("the hearing notice");
    assert_eq!(notice.id, HEARING_NOTICE_ID);
    assert_eq!(
        notice.wide,
        Some(StripMessage::HealthHearing {
            percent: 90,
            minutes: 10,
        })
    );
    let warned = rig.snapshot().hearing.expect("still loud");
    assert!(warned.warned);
    assert_eq!(warned.loud_for_ms, ms(minutes(10)));

    rig.run_for(minutes(10));
    assert_eq!(rig.notices().len(), 1, "one warning per loud stretch");

    rig.volume(90, true);
    assert_eq!(rig.snapshot().hearing, None, "muting ends the stretch");
    // The strip loop would have expired the first notice long ago.
    rig.hub.refresh();
    rig.volume(90, false);
    rig.run_for(minutes(10));
    assert_eq!(rig.notices().len(), 2, "a new stretch warns again");
    assert!(rig.snapshot().hearing.is_some_and(|hearing| hearing.warned));
}

#[test]
fn speakers_and_disconnected_headphones_do_not_warn() {
    let rig = Rig::new();
    rig.volume(100, false);
    assert_eq!(rig.snapshot().hearing, None);
    rig.bluetooth(headphones("bt-1", "Buds", false));
    assert_eq!(rig.snapshot().hearing, None);
    rig.bluetooth(headphones("bt-1", "Buds", true));
    assert!(
        rig.snapshot().hearing.is_some(),
        "connecting starts the clock"
    );
    rig.bluetooth(headphones("bt-1", "Buds", false));
    assert_eq!(rig.snapshot().hearing, None, "taking them off stops it");
    rig.run_for(minutes(15));
    assert!(rig.notices().is_empty());
}

#[test]
fn headphones_are_told_by_name_when_the_kind_is_unknown() {
    let rig = Rig::new();
    rig.bluetooth(BluetoothDevice {
        id: "bt-2".to_owned(),
        name: "Sony Headphones".to_owned(),
        connected: true,
        battery_percent: None,
        kind: BluetoothDeviceKind::Other,
    });
    rig.volume(90, false);
    assert!(rig.snapshot().hearing.is_some());
}

#[test]
fn the_hearing_warning_can_be_turned_off() {
    let rig = Rig::build(
        &HealthSettings {
            hearing_warning: false,
            ..HealthSettings::default()
        },
        |platform| {
            platform.set_bluetooth_device(headphones("bt-1", "WH-1000XM4", true));
        },
    );
    rig.volume(95, false);
    rig.run_for(minutes(15));
    assert!(rig.notices().is_empty());
}

// --- settings --------------------------------------------------------------------------------

#[test]
fn turning_the_module_off_stops_everything() {
    let rig = Rig::with_settings(&HealthSettings {
        enabled: false,
        ..HealthSettings::default()
    });
    let snapshot = rig.snapshot();
    assert!(!snapshot.enabled);
    assert_eq!(snapshot.sitting, SittingStatus::Off);
    assert_eq!(snapshot.sitting_since_ms, None);
    assert_eq!(snapshot.next_break_in_ms, None);
    assert_eq!(rig.service.next_wake(), None, "the loop sleeps");
    rig.run_for(minutes(60));
    assert!(rig.notices().is_empty());
    assert_eq!(rig.snapshot().today.active_ms, 0);
}

#[test]
fn turning_the_module_off_and_on_again() {
    let rig = Rig::new();
    rig.run_for(minutes(20));
    rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Move,
    });
    rig.apply(&HealthSettings {
        enabled: false,
        ..HealthSettings::default()
    });
    let off = rig.snapshot();
    assert_eq!(off.sitting, SittingStatus::Off);
    assert_eq!(off.flow, None, "flows stop with the module");
    assert!(rig.flow_activity().is_none());
    assert_eq!(off.today.active_ms, ms(minutes(20)));

    rig.clock.advance(minutes(10));
    rig.apply(&HealthSettings::default());
    let on = rig.snapshot();
    assert_eq!(on.sitting, SittingStatus::Sitting);
    assert_eq!(on.sitting_since_ms, Some(rig.now_ms()));
    assert_eq!(on.today.breaks, 1, "ten minutes off after a 20 min sit");
}

#[test]
fn settings_round_trip_and_clamp() {
    let mut document = Settings::default();
    assert_eq!(
        HealthSettings::from_document(&document),
        HealthSettings::default(),
        "missing namespace reads as defaults"
    );
    let wanted = HealthSettings {
        enabled: false,
        break_every_min: 30,
        water_goal: 10,
        wind_down_hour: Some(21),
        hearing_warning: false,
        breathe_pattern: BreathePattern::Relax,
    };
    wanted.write(&mut document).expect("serialises");
    assert_eq!(HealthSettings::from_document(&document), wanted);

    let wild = HealthSettings {
        break_every_min: 5,
        water_goal: 0,
        wind_down_hour: Some(3),
        ..HealthSettings::default()
    }
    .clamped();
    assert_eq!(wild.break_every_min, BREAK_EVERY_MINUTES.0);
    assert_eq!(wild.water_goal, WATER_GOAL.0);
    assert_eq!(wild.wind_down_hour, Some(WIND_DOWN_HOUR.0));
    let wild = HealthSettings {
        break_every_min: 250,
        water_goal: 99,
        wind_down_hour: Some(30),
        ..HealthSettings::default()
    }
    .clamped();
    assert_eq!(wild.break_every_min, BREAK_EVERY_MINUTES.1);
    assert_eq!(wild.water_goal, WATER_GOAL.1);
    assert_eq!(wild.wind_down_hour, Some(WIND_DOWN_HOUR.1));

    document.modules.insert(
        HealthSettings::KEY.to_owned(),
        serde_json::json!({ "breakEveryMin": "soon", "enabled": true }),
    );
    assert_eq!(
        HealthSettings::from_document(&document),
        HealthSettings::default(),
        "malformed reads as defaults"
    );
}

#[test]
fn wind_down_follows_the_local_hour() {
    let rig = Rig::with_settings(&HealthSettings {
        wind_down_hour: Some(18),
        ..HealthSettings::default()
    });
    assert!(!rig.snapshot().winding_down, "06:00");
    rig.run_for(minutes(12 * 60));
    assert!(rig.snapshot().winding_down, "18:00");
    rig.run_for(minutes(10 * 60));
    assert!(rig.snapshot().winding_down, "04:00 the next morning");
    rig.run_for(minutes(60));
    assert!(!rig.snapshot().winding_down, "05:00");
}

#[test]
fn the_snapshot_serialises_for_the_ui() {
    let rig = Rig::new();
    rig.command(HealthCommand::StartFlow {
        flow: HealthFlow::Breathe,
    });
    let json = serde_json::to_value(rig.snapshot()).expect("serialises");
    assert_eq!(json["sitting"], "sitting");
    assert_eq!(json["sittingSinceMs"], ORIGIN_MS);
    assert_eq!(json["flow"]["flow"], "breathe");
    assert_eq!(json["flow"]["pattern"], "box");
    assert_eq!(json["goals"]["mindfulSeconds"], MINDFUL_GOAL_SECONDS);
    assert_eq!(json["week"].as_array().map(Vec::len), Some(WEEK_DAYS));
    let command: HealthCommand =
        serde_json::from_value(serde_json::json!({ "kind": "water", "delta": -1 }))
            .expect("parses");
    assert_eq!(command, HealthCommand::Water { delta: -1 });
    let command: HealthCommand =
        serde_json::from_value(serde_json::json!({ "kind": "startFlow", "flow": "eyeRest" }))
            .expect("parses");
    assert_eq!(
        command,
        HealthCommand::StartFlow {
            flow: HealthFlow::EyeRest,
        }
    );
}
