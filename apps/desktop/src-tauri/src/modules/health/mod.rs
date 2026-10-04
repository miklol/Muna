//! The `health` module backend (docs/modules/health.md): a sitting timer from input activity,
//! break reminders as strip notices, guided flows (Move, Breathe, Stretch, Eye rest) shown as a
//! countdown in the strip and inside the pinned panel, a water log, and a hearing warning for
//! loud audio on headphones. Counters live one row per day in the profile database; nothing
//! about *what* the user was doing is kept.
//!
//! [`HealthService`] is the shared object: the IPC commands drive it, the backend runs its
//! tick loop and feeds it platform events, and it tells a [`HealthSink`] whenever the panel's
//! snapshot changed. The reasoning about time is in [`tracker::Tracker`], which is pure, so
//! `tests/health.rs` drives the service with a `FakeClock` and a `FakePlatform`.

pub mod settings;
pub mod tracker;

use std::collections::HashSet;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Glyph, HealthDayRecord, HealthFlow, Hub, Int53, Leading, Notice, Settings,
    Store, StripMessage, Tint, Trailing, activities::priority,
};
use muna_platform::{BluetoothDevice, BluetoothDeviceKind, Platform, PlatformEvent};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::{BreathePattern, HealthSettings};
pub use tracker::{Away, RunningFlow, Tracker};
use tracker::{DAY_MS, Effect, MINDFUL_GOAL_SECONDS};

pub const ID: &str = "health";
pub const FLOW_ACTIVITY_ID: &str = "health:flow";
pub const BREAK_NOTICE_ID: &str = "health:break";
pub const FLOW_FINISHED_NOTICE_ID: &str = "health:flow-finished";
pub const HEARING_NOTICE_ID: &str = "health:hearing";

/// How often the idle time is sampled and deadlines are checked while the user is at the
/// desk. The UI counts the sitting time and a flow down locally between snapshots; this is
/// not a render cadence.
pub const TICK: Duration = Duration::from_secs(30);
/// The break reminder holds the strip longer than a plain notice: it is asking for something.
pub const BREAK_NOTICE_HOLD: Duration = Duration::from_secs(8);
/// Days the weekday dots cover, today included.
pub const WEEK_DAYS: usize = 7;
/// Days of counters kept; streaks are counted within this window.
pub const RETENTION_DAYS: i64 = 90;

/// Where "today" starts: the machine's zone at each wake (daylight saving included) in the
/// app, a fixed offset in tests. Modules do not import each other, so this mirrors the
/// screen-time module's trait rather than sharing it.
pub trait Zone: Send + Sync {
    fn offset_seconds(&self, at: SystemTime) -> i32;
}

/// The machine's zone.
#[derive(Debug, Clone, Copy, Default)]
pub struct LocalZone;

impl Zone for LocalZone {
    fn offset_seconds(&self, at: SystemTime) -> i32 {
        chrono::DateTime::<chrono::Local>::from(at)
            .offset()
            .local_minus_utc()
    }
}

/// A zone that never changes, for tests.
#[derive(Debug, Clone, Copy)]
pub struct FixedZone(pub i32);

impl Zone for FixedZone {
    fn offset_seconds(&self, _at: SystemTime) -> i32 {
        self.0
    }
}

/// Where the user is, as far as input activity says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum SittingStatus {
    /// At the desk; `sittingSinceMs` says since when.
    Sitting,
    /// No input for a few minutes or the machine slept; the sit is paused.
    Away,
    /// The session is locked.
    Locked,
    /// The module is off.
    Off,
}

/// Today's counters as the panel shows them. Durations are `u32` milliseconds: a day is
/// 86 400 000 ms.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthDay {
    /// Time at the desk today, the open sit included.
    pub active_ms: u32,
    /// The longest sit today, the open one included.
    pub longest_sit_ms: u32,
    pub breaks: u32,
    pub water: u32,
    pub mindful_seconds: u32,
    pub flows: u32,
}

/// What fills each ring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthGoals {
    pub breaks: u32,
    pub water: u32,
    pub mindful_seconds: u32,
}

/// One weekday dot.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthWeekDay {
    #[specta(type = Int53)]
    pub day_start_ms: i64,
    pub breaks: u32,
    pub water: u32,
    pub mindful_seconds: u32,
    /// How many of the three goals the day met (0–3).
    pub goals_met: u8,
}

/// The running flow; the UI counts `remainingMs` down from `generatedAtMs`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FlowState {
    pub flow: HealthFlow,
    #[specta(type = Int53)]
    pub started_ms: i64,
    pub remaining_ms: u32,
    pub total_ms: u32,
    /// The Breathe pacing in force (other flows ignore it).
    pub pattern: BreathePattern,
}

/// Loud audio on headphones right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HearingState {
    pub percent: u8,
    pub loud_for_ms: u32,
    /// The warning has been raised for this stretch.
    pub warned: bool,
}

/// Everything the panel shows (docs/modules/health.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HealthSnapshot {
    pub enabled: bool,
    pub sitting: SittingStatus,
    /// While sitting: when the sit began; the UI counts up from it.
    #[specta(type = Option<Int53>)]
    pub sitting_since_ms: Option<i64>,
    /// The sit so far, exact at `generatedAtMs` (frozen while away).
    pub sitting_ms: u32,
    /// While sitting and no reminder is up: time to the next reminder.
    pub next_break_in_ms: Option<u32>,
    /// A reminder is up and unanswered since this time.
    #[specta(type = Option<Int53>)]
    pub break_due_since_ms: Option<i64>,
    pub today: HealthDay,
    pub goals: HealthGoals,
    /// The last seven days, oldest first, today last.
    pub week: Vec<HealthWeekDay>,
    /// Days in a row, ending today or yesterday, with at least one goal met.
    pub streak_days: u32,
    pub flow: Option<FlowState>,
    pub hearing: Option<HearingState>,
    /// The evening wind-down is in force (`windDownHour`).
    pub winding_down: bool,
    #[specta(type = Int53)]
    pub day_start_ms: i64,
    #[specta(type = Int53)]
    pub generated_at_ms: i64,
}

/// What the panel can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum HealthCommand {
    /// Starts a guided flow (replacing a running one) and answers the break reminder.
    StartFlow { flow: HealthFlow },
    /// Stops the running flow early.
    StopFlow,
    /// Logs `delta` glasses of water; negative undoes.
    Water { delta: i32 },
    /// Reminder again in ten minutes.
    Snooze,
    /// Puts the reminder away until the next interval.
    Dismiss,
    /// Today's counters back to zero; the sit starts over.
    Reset,
    /// Forgets every day's counters.
    ClearHistory,
}

/// Where the module reports a fresh snapshot; the shell bridges it to a Tauri event.
pub trait HealthSink: Send + Sync {
    fn changed(&self, snapshot: &HealthSnapshot);
}

pub struct HealthService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    zone: Arc<dyn Zone>,
    settings: Mutex<HealthSettings>,
    tracker: Mutex<Tracker>,
    /// Connected Bluetooth devices classified as headphones.
    bluetooth_headphones: Mutex<HashSet<String>>,
    /// The default render device is named like headphones (a wired headset).
    wired_headphones: Mutex<bool>,
    sink: Mutex<Option<Arc<dyn HealthSink>>>,
    /// Wakes the tick loop when a deadline or the cadence changed.
    pub(crate) wake: Notify,
}

impl std::fmt::Debug for HealthService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HealthService")
            .field("settings", &*self.settings.lock())
            .field("tracker", &*self.tracker.lock())
            .finish_non_exhaustive()
    }
}

impl HealthService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        hub: Arc<Hub>,
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        zone: Arc<dyn Zone>,
    ) -> Self {
        let now = unix_ms(clock.system_time());
        let day_start = tracker::day_start(now, zone.offset_seconds(clock.system_time()));
        let today = store.health_day(day_start).unwrap_or_else(|error| {
            tracing::warn!(%error, "health counters unavailable; starting from zero");
            None
        });
        Self {
            platform,
            hub,
            store,
            clock,
            zone,
            settings: Mutex::new(HealthSettings::default()),
            tracker: Mutex::new(Tracker::new(day_start, today)),
            bluetooth_headphones: Mutex::new(HashSet::new()),
            wired_headphones: Mutex::new(false),
            sink: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn HealthSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> HealthSettings {
        self.settings.lock().clone()
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    fn offset_seconds(&self) -> i32 {
        self.zone.offset_seconds(self.clock.system_time())
    }

    /// Applies `settings.modules.health` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = HealthSettings::from_document(settings);
        let previous = {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            std::mem::replace(&mut *current, next.clone())
        };
        let now = self.now_ms();
        let mut tracker = self.tracker.lock();
        let before = tracker.view();
        let mut effects = Vec::new();
        if previous.enabled != next.enabled {
            effects.extend(tracker.set_enabled(next.enabled, now, &next));
        }
        if previous.break_every_min != next.break_every_min {
            tracker.apply_interval(&next);
        }
        self.finish_step(&mut tracker, before, &effects, now, &next, true);
    }

    /// Runs one command and returns the snapshot after it.
    pub fn command(&self, command: HealthCommand) -> HealthSnapshot {
        let settings = self.settings();
        let now = self.now_ms();
        let mut tracker = self.tracker.lock();
        let before = tracker.view();
        let effects = match command {
            HealthCommand::StartFlow { flow } => tracker.start_flow(flow, now, &settings),
            HealthCommand::StopFlow => tracker.stop_flow(now),
            HealthCommand::Water { delta } => {
                tracker.water(delta);
                Vec::new()
            }
            HealthCommand::Snooze => tracker.snooze(now),
            HealthCommand::Dismiss => tracker.dismiss(),
            HealthCommand::Reset => tracker.reset(now, &settings),
            HealthCommand::ClearHistory => {
                if let Err(error) = self.store.clear_health_days() {
                    tracing::warn!(%error, "health history could not be cleared");
                }
                tracker.reset(now, &settings)
            }
        };
        tracing::debug!(?command, "health command");
        self.finish_step(&mut tracker, before, &effects, now, &settings, true);
        self.snapshot_of(&tracker, &settings, now)
    }

    /// One step of the loop: idle, sleep gaps, the day boundary, deadlines. Blocking (it reads
    /// the idle time and, when a reminder is due, the foreground state) — the backend calls
    /// it from a blocking task.
    pub fn tick(&self) {
        let settings = self.settings();
        let now = self.now_ms();
        let day_start = tracker::day_start(now, self.offset_seconds());
        let idle_ms = self
            .platform
            .foreground()
            .idle_for()
            .ok()
            .and_then(|idle| i64::try_from(idle.as_millis()).ok())
            .unwrap_or(0);
        let mut tracker = self.tracker.lock();
        let suppressed = tracker.remind_at_ms().is_some_and(|at| now >= at) && self.suppressed();
        let before = tracker.view();
        let effects = tracker.tick(now, idle_ms, day_start, suppressed, &settings);
        self.finish_step(&mut tracker, before, &effects, now, &settings, false);
    }

    /// A platform event the module listens for. Blocking on a volume change (it looks at the
    /// default render device) — the backend calls it from a blocking task.
    pub fn handle_event(&self, event: &PlatformEvent) {
        match event {
            PlatformEvent::VolumeChanged { percent, muted } => {
                self.refresh_wired_headphones();
                let now = self.now_ms();
                let headphones = self.headphones();
                let settings = self.settings();
                let mut tracker = self.tracker.lock();
                let before = tracker.view();
                tracker.set_volume(*percent, *muted, now);
                tracker.set_headphones(headphones, now);
                self.finish_step(&mut tracker, before, &[], now, &settings, false);
            }
            PlatformEvent::BluetoothChanged(device) => {
                self.note_bluetooth(device);
                let now = self.now_ms();
                let headphones = self.headphones();
                let settings = self.settings();
                let mut tracker = self.tracker.lock();
                let before = tracker.view();
                tracker.set_headphones(headphones, now);
                self.finish_step(&mut tracker, before, &[], now, &settings, false);
            }
            PlatformEvent::SessionLockChanged { locked } => {
                let settings = self.settings();
                let now = self.now_ms();
                let mut tracker = self.tracker.lock();
                let before = tracker.view();
                let effects = tracker.set_locked(*locked, now, &settings);
                self.finish_step(&mut tracker, before, &effects, now, &settings, false);
            }
            _ => {}
        }
    }

    /// Reads what the platform knows now (volume, the default device, connected headphones)
    /// and starts the sit when the module is on. Blocking; the backend calls it once from a
    /// blocking task, before the loops start.
    pub fn prime(&self) {
        let audio = self.platform.audio();
        let volume = audio.volume().ok();
        let muted = audio.muted().ok();
        self.refresh_wired_headphones();
        if let Ok(devices) = self.platform.bluetooth().devices() {
            for device in &devices {
                self.note_bluetooth(device);
            }
        }
        let settings = self.settings();
        let now = self.now_ms();
        let headphones = self.headphones();
        let mut tracker = self.tracker.lock();
        let before = tracker.view();
        if let (Some(percent), Some(muted)) = (volume, muted) {
            tracker.set_volume(percent, muted, now);
        }
        tracker.set_headphones(headphones, now);
        let effects = tracker.set_enabled(settings.enabled, now, &settings);
        self.finish_step(&mut tracker, before, &effects, now, &settings, true);
    }

    /// How long the loop may sleep: until the next deadline or [`TICK`] while the user is at
    /// the desk (or a flow or the hearing clock runs), forever otherwise (an event wakes it).
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let settings = self.settings();
        if !settings.enabled {
            return None;
        }
        let now = self.now_ms();
        let tracker = self.tracker.lock();
        let deadline = tracker
            .next_deadline_ms(&settings)
            .map(|at| Duration::from_millis(u64::try_from((at - now).max(0)).unwrap_or(0)));
        match tracker.away() {
            // Nothing moves while locked or off except a flow's end or the hearing clock.
            Some(Away::Locked | Away::Off) => deadline,
            Some(Away::Idle | Away::Asleep) | None => Some(deadline.map_or(TICK, |d| d.min(TICK))),
        }
    }

    /// Everything the panel shows. Reads the retention window from the store, so it runs on a
    /// blocking thread.
    #[must_use]
    pub fn snapshot(&self) -> HealthSnapshot {
        let settings = self.settings();
        let now = self.now_ms();
        let tracker = self.tracker.lock();
        self.snapshot_of(&tracker, &settings, now)
    }

    fn snapshot_of(
        &self,
        tracker: &Tracker,
        settings: &HealthSettings,
        now: i64,
    ) -> HealthSnapshot {
        let today_record = tracker.today_at(now);
        let day_start = today_record.day_start_ms;
        let goals = HealthGoals {
            breaks: tracker::breaks_goal(settings),
            water: u32::from(settings.water_goal),
            mindful_seconds: MINDFUL_GOAL_SECONDS,
        };
        let history = self
            .store
            .health_days_between(day_start - RETENTION_DAYS * DAY_MS, day_start)
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "health history unavailable");
                Vec::new()
            });
        let week = week_of(&history, today_record, goals);
        let streak_days = streak_of(&history, today_record, goals);
        let sitting = match tracker.away() {
            None if tracker.is_sitting() => SittingStatus::Sitting,
            None | Some(Away::Idle | Away::Asleep) => SittingStatus::Away,
            Some(Away::Locked) => SittingStatus::Locked,
            Some(Away::Off) => SittingStatus::Off,
        };
        let sitting = if settings.enabled {
            sitting
        } else {
            SittingStatus::Off
        };
        let flow = tracker.flow().map(|flow| FlowState {
            flow: flow.flow,
            started_ms: flow.started_ms,
            remaining_ms: flow.remaining_ms(now),
            total_ms: flow.total_ms,
            pattern: settings.breathe_pattern,
        });
        let hearing = tracker.loud_since_ms().map(|since| HearingState {
            percent: tracker.volume().0,
            loud_for_ms: clamp_ms(now - since),
            warned: tracker.hearing_warned(),
        });
        HealthSnapshot {
            enabled: settings.enabled,
            sitting,
            sitting_since_ms: tracker.sit_start_ms(),
            sitting_ms: clamp_ms(tracker.sitting_ms(now).unwrap_or(0)),
            next_break_in_ms: tracker
                .remind_at_ms()
                .filter(|_| tracker.break_due_since_ms().is_none() && tracker.flow().is_none())
                .map(|at| clamp_ms(at - now)),
            break_due_since_ms: tracker.break_due_since_ms(),
            today: day_of(today_record),
            goals,
            week,
            streak_days,
            flow,
            hearing,
            winding_down: tracker::winding_down(
                tracker::local_hour(now, self.offset_seconds()),
                settings,
            ),
            day_start_ms: day_start,
            generated_at_ms: now,
        }
    }

    /// After a tracker step: strip effects, persistence, the sink and the loop's wake.
    fn finish_step(
        &self,
        tracker: &mut Tracker,
        before: tracker::View,
        effects: &[Effect],
        now: i64,
        settings: &HealthSettings,
        force_publish: bool,
    ) {
        for effect in effects {
            self.apply_effect(effect, tracker, now);
        }
        if tracker.take_dirty()
            && let Err(error) = self.store.save_health_day(&tracker.today())
        {
            tracing::warn!(%error, "health counters could not be saved");
        }
        let changed = force_publish || !effects.is_empty() || tracker.view() != before;
        if changed {
            let snapshot = self.snapshot_of(tracker, settings, now);
            let sink = self.sink.lock().clone();
            if let Some(sink) = sink {
                sink.changed(&snapshot);
            }
            self.wake.notify_one();
        }
    }

    fn apply_effect(&self, effect: &Effect, tracker: &mut Tracker, now: i64) {
        match effect {
            Effect::RemindBreak { minutes } => {
                tracing::info!(minutes, "health: time for a break");
                self.hub.publish_notice(break_notice(*minutes));
            }
            // The notice expires on its own; the panel state is what changes.
            Effect::RetractBreak => {}
            Effect::FlowStarted => {
                if let Some(flow) = tracker.flow() {
                    self.hub.publish_activity(flow_activity(&flow, now));
                }
            }
            Effect::FlowStopped => self.hub.retract_activity(FLOW_ACTIVITY_ID),
            Effect::FlowFinished(flow) => {
                tracing::info!(?flow, "health: flow finished");
                self.hub.retract_activity(FLOW_ACTIVITY_ID);
                self.hub.publish_notice(flow_finished_notice(*flow));
            }
            Effect::HearingWarning { percent, minutes } => {
                tracing::info!(percent, minutes, "health: loud on headphones");
                self.hub.publish_notice(hearing_notice(*percent, *minutes));
            }
            Effect::DayClosed(record) => {
                if let Err(error) = self.store.save_health_day(record) {
                    tracing::warn!(%error, "health: yesterday could not be saved");
                }
                let day_start = tracker.today().day_start_ms;
                match self.store.health_day(day_start) {
                    Ok(Some(stored)) => tracker.merge_today(stored),
                    Ok(None) => {}
                    Err(error) => tracing::warn!(%error, "health: today could not be read"),
                }
                if let Err(error) = self
                    .store
                    .prune_health_before(day_start - RETENTION_DAYS * DAY_MS)
                {
                    tracing::warn!(%error, "health retention prune failed");
                }
            }
        }
    }

    fn headphones(&self) -> bool {
        *self.wired_headphones.lock() || !self.bluetooth_headphones.lock().is_empty()
    }

    fn note_bluetooth(&self, device: &BluetoothDevice) {
        let kind = match device.kind {
            BluetoothDeviceKind::Other => BluetoothDeviceKind::from_name(&device.name),
            kind => kind,
        };
        let mut set = self.bluetooth_headphones.lock();
        if device.connected && kind == BluetoothDeviceKind::Headphones {
            set.insert(device.id.clone());
        } else {
            set.remove(&device.id);
        }
    }

    /// Whether the default render device is named like headphones ("Headphones (Realtek
    /// Audio)"): the only hint Windows gives about a wired headset without a form-factor
    /// query.
    fn refresh_wired_headphones(&self) {
        let wired = self
            .platform
            .audio()
            .devices()
            .ok()
            .and_then(|devices| devices.into_iter().find(|device| device.is_default))
            .is_some_and(|device| {
                BluetoothDeviceKind::from_name(&device.name) == BluetoothDeviceKind::Headphones
            });
        *self.wired_headphones.lock() = wired;
    }

    /// A fullscreen app or a presentation is in front: the shell would park the notch, so a
    /// reminder now would go unseen (docs/modules/health.md acceptance criteria).
    fn suppressed(&self) -> bool {
        let Ok(state) = self.platform.windowing().user_notification_state() else {
            return false;
        };
        let fullscreen = self
            .platform
            .foreground()
            .current()
            .ok()
            .flatten()
            .map(|window| window.is_fullscreen);
        state.should_park(fullscreen)
    }
}

/// The last [`WEEK_DAYS`] days, oldest first, today last; days without a record are zero.
fn week_of(
    history: &[HealthDayRecord],
    today: HealthDayRecord,
    goals: HealthGoals,
) -> Vec<HealthWeekDay> {
    (1..WEEK_DAYS)
        .rev()
        .map(|back| {
            let start = today.day_start_ms - i64::try_from(back).unwrap_or(0) * DAY_MS;
            history
                .iter()
                .find(|day| day.day_start_ms == start)
                .copied()
                .unwrap_or(HealthDayRecord {
                    day_start_ms: start,
                    ..HealthDayRecord::default()
                })
        })
        .chain(std::iter::once(today))
        .map(|day| HealthWeekDay {
            day_start_ms: day.day_start_ms,
            breaks: day.breaks,
            water: day.water,
            mindful_seconds: day.mindful_seconds,
            goals_met: goals_met(day, goals),
        })
        .collect()
}

/// Days in a row with at least one goal met, counting back from today (or from yesterday
/// when today has none yet, so a streak is not lost before the day is over).
fn streak_of(history: &[HealthDayRecord], today: HealthDayRecord, goals: HealthGoals) -> u32 {
    let mut streak = 0;
    let mut cursor = today.day_start_ms;
    if goals_met(today, goals) > 0 {
        streak += 1;
    }
    loop {
        cursor -= DAY_MS;
        let Some(day) = history.iter().find(|day| day.day_start_ms == cursor) else {
            break;
        };
        if goals_met(*day, goals) == 0 {
            break;
        }
        streak += 1;
    }
    streak
}

fn goals_met(day: HealthDayRecord, goals: HealthGoals) -> u8 {
    u8::from(day.breaks >= goals.breaks)
        + u8::from(day.water >= goals.water)
        + u8::from(day.mindful_seconds >= goals.mindful_seconds)
}

fn day_of(record: HealthDayRecord) -> HealthDay {
    HealthDay {
        active_ms: clamp_ms(record.active_ms),
        longest_sit_ms: clamp_ms(record.longest_sit_ms),
        breaks: record.breaks,
        water: record.water,
        mindful_seconds: record.mindful_seconds,
        flows: record.flows,
    }
}

/// The strip countdown for a running flow; the UI counts down from `now_ms`.
#[must_use]
pub fn flow_activity(flow: &RunningFlow, now_ms: i64) -> Activity {
    Activity {
        id: FLOW_ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::HEALTH_FLOW,
        leading: Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(flow_tint(flow.flow)),
        }),
        trailing: Some(Trailing::Timer {
            remaining_ms: flow.remaining_ms(now_ms),
            total_ms: flow.total_ms,
            running: true,
        }),
        wide: Some(StripMessage::HealthFlow { flow: flow.flow }),
    }
}

/// Time for a break: holds the strip for [`BREAK_NOTICE_HOLD`].
#[must_use]
pub fn break_notice(minutes: u32) -> Notice {
    Notice {
        id: BREAK_NOTICE_ID.into(),
        module: ID.into(),
        priority: priority::HEALTH,
        leading: Some(Leading::Icon {
            glyph: Glyph::Heart,
            tint: Some(Tint::Pink),
        }),
        trailing: None,
        wide: Some(StripMessage::HealthBreak { minutes }),
        hold_ms: clamp_ms(i64::try_from(BREAK_NOTICE_HOLD.as_millis()).unwrap_or(0)),
    }
}

/// A flow ran its course; holds the strip for the default 4 s.
#[must_use]
pub fn flow_finished_notice(flow: HealthFlow) -> Notice {
    Notice {
        id: FLOW_FINISHED_NOTICE_ID.into(),
        module: ID.into(),
        priority: priority::HEALTH,
        leading: Some(Leading::Icon {
            glyph: Glyph::Heart,
            tint: Some(flow_tint(flow)),
        }),
        trailing: None,
        wide: Some(StripMessage::HealthFlowFinished { flow }),
        hold_ms: 0,
    }
}

/// Loud on headphones for a while.
#[must_use]
pub fn hearing_notice(percent: u8, minutes: u32) -> Notice {
    Notice {
        id: HEARING_NOTICE_ID.into(),
        module: ID.into(),
        priority: priority::HEALTH,
        leading: Some(Leading::Icon {
            glyph: Glyph::VolumeHigh,
            tint: Some(Tint::Orange),
        }),
        trailing: None,
        wide: Some(StripMessage::HealthHearing { percent, minutes }),
        hold_ms: clamp_ms(i64::try_from(BREAK_NOTICE_HOLD.as_millis()).unwrap_or(0)),
    }
}

/// The rings' colours (docs/05-design-system.md): move is green, mindful is purple, eyes are
/// blue like water.
#[must_use]
pub const fn flow_tint(flow: HealthFlow) -> Tint {
    match flow {
        HealthFlow::Move | HealthFlow::Stretch => Tint::Green,
        HealthFlow::Breathe => Tint::Purple,
        HealthFlow::EyeRest => Tint::Blue,
    }
}

fn clamp_ms(ms: i64) -> u32 {
    u32::try_from(ms.max(0)).unwrap_or(u32::MAX)
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: primes the service, runs the tick loop and feeds it platform events.
#[derive(Debug, Clone)]
pub struct HealthModule(pub Arc<HealthService>);

impl ModuleBackend for HealthModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            let primer = Arc::clone(&service);
            if let Err(error) = tauri::async_runtime::spawn_blocking(move || primer.prime()).await {
                tracing::warn!(%error, "health prime task failed");
            }
            loop {
                match service.next_wake() {
                    None => service.wake.notified().await,
                    Some(wait) => {
                        tokio::select! {
                            () = tokio::time::sleep(wait) => {}
                            () = service.wake.notified() => {}
                        }
                    }
                }
                let ticker = Arc::clone(&service);
                // The idle read and the database write stay off the async threads.
                if let Err(error) =
                    tauri::async_runtime::spawn_blocking(move || ticker.tick()).await
                {
                    tracing::warn!(%error, "health tick task failed");
                }
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(
                        event @ (PlatformEvent::VolumeChanged { .. }
                        | PlatformEvent::BluetoothChanged(_)
                        | PlatformEvent::SessionLockChanged { .. }),
                    ) => {
                        let handler = Arc::clone(&service);
                        // Awaited so events are applied in the order they arrived.
                        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
                            handler.handle_event(&event);
                        })
                        .await
                        {
                            tracing::warn!(%error, "health event task failed");
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "health events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
