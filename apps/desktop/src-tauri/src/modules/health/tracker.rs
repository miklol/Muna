//! The sitting timer, the break reminder, the guided flows and the hearing watch as one pure
//! state machine over wall-clock milliseconds (docs/modules/health.md). Every input is a fact
//! the service observed — how long the input has been idle, a lock, a volume — with the time it
//! holds at, and every method answers with the [`Effect`]s the strip needs. No clock, no
//! platform, no store: `tests/health.rs` drives it directly.
//!
//! A *sit* runs from the moment input resumes until the user is away: no input for
//! [`AWAY_AFTER_MS`], the session locked, the machine asleep, or the module turned off. A short
//! absence is skipped (the sit continues where it was); a long one ends the sit — and, when
//! the sit was long enough to need one, counts as a break. Guided Move and Stretch flows count
//! as breaks in their own right and start a fresh sit when they finish.

use muna_core::{HealthDayRecord, HealthFlow};

use super::settings::{BreathePattern, HealthSettings};

pub const MINUTE_MS: i64 = 60_000;
pub const HOUR_MS: i64 = 60 * MINUTE_MS;
pub const DAY_MS: i64 = 24 * HOUR_MS;

/// No input this long and the user is taken to have stepped away.
pub const AWAY_AFTER_MS: i64 = 3 * MINUTE_MS;
/// A tick this late means the machine slept; the sit ended at the last tick.
pub const SLEEP_GAP_MS: i64 = 2 * MINUTE_MS;
/// A sit shorter than this is not worth a break when it ends: sitting down for a minute and
/// leaving again is not "taking a break".
pub const MIN_SIT_FOR_BREAK_MS: i64 = 10 * MINUTE_MS;
/// *Snooze* on the break reminder.
pub const SNOOZE_MS: i64 = 10 * MINUTE_MS;
/// How long a reminder waits when a fullscreen app or a presentation is in front.
pub const DEFER_MS: i64 = 5 * MINUTE_MS;
/// Today's active time is credited to the record at least this often while sitting, so a
/// crash loses no more than this.
pub const CREDIT_EVERY_MS: i64 = 5 * MINUTE_MS;
/// Above this volume on headphones the hearing clock starts...
pub const LOUD_PERCENT: u8 = 85;
/// ...and runs this long before the warning.
pub const LOUD_AFTER_MS: i64 = 10 * MINUTE_MS;
/// Seconds of paced breathing that fill the purple ring.
pub const MINDFUL_GOAL_SECONDS: u32 = 10 * 60;
/// Sitting hours a day the breaks goal is derived from: one break per interval over six
/// hours at the desk (50 min → 7).
pub const BREAKS_GOAL_HOURS: u32 = 6;
/// Wind-down runs from the setting's hour until this local hour the next morning.
pub const WIND_DOWN_END_HOUR: u8 = 5;

/// Why the user is not sitting right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Away {
    /// No input for [`AWAY_AFTER_MS`].
    Idle,
    Locked,
    /// The tick loop missed [`SLEEP_GAP_MS`]: standby or hibernation.
    Asleep,
    /// The module is off.
    Off,
}

/// A guided flow in progress.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RunningFlow {
    pub flow: HealthFlow,
    pub started_ms: i64,
    pub total_ms: u32,
}

impl RunningFlow {
    #[must_use]
    pub fn ends_ms(&self) -> i64 {
        self.started_ms + i64::from(self.total_ms)
    }

    #[must_use]
    pub fn remaining_ms(&self, now_ms: i64) -> u32 {
        u32::try_from((self.ends_ms() - now_ms).max(0)).unwrap_or(u32::MAX)
    }
}

/// What the service publishes after a step; the state itself is read back from the tracker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Time for a break: raise the notice (`minutes` sitting so far).
    RemindBreak { minutes: u32 },
    /// The reminder is answered or moot: take the notice back.
    RetractBreak,
    /// A flow started, or replaced the running one: publish the countdown.
    FlowStarted,
    /// The user stopped the flow: retract the countdown.
    FlowStopped,
    /// The flow ran its course: retract the countdown and raise the finished notice.
    FlowFinished(HealthFlow),
    /// Loud audio on headphones for [`LOUD_AFTER_MS`]: raise the warning.
    HearingWarning { percent: u8, minutes: u32 },
    /// The day rolled over; this is yesterday's final record, to persist.
    DayClosed(HealthDayRecord),
}

/// Length of a flow, given the Breathe pacing.
#[must_use]
pub const fn flow_total_ms(flow: HealthFlow, pattern: BreathePattern) -> u32 {
    match flow {
        HealthFlow::Move => 180_000,
        HealthFlow::Stretch => 120_000,
        HealthFlow::EyeRest => 20_000,
        HealthFlow::Breathe => match pattern {
            // Eight 16 s box cycles; six 19 s relax cycles: about two minutes either way.
            BreathePattern::Box => 8 * 16_000,
            BreathePattern::Relax => 6 * 19_000,
        },
    }
}

/// Breaks that fill the green ring: one per interval over [`BREAKS_GOAL_HOURS`].
#[must_use]
pub fn breaks_goal(settings: &HealthSettings) -> u32 {
    (BREAKS_GOAL_HOURS * 60 / u32::from(settings.break_every_min.max(1))).max(1)
}

/// The start of the local day containing `now_ms`.
#[must_use]
pub fn day_start(now_ms: i64, offset_seconds: i32) -> i64 {
    let offset_ms = i64::from(offset_seconds) * 1000;
    let local = now_ms.saturating_add(offset_ms);
    local.div_euclid(DAY_MS) * DAY_MS - offset_ms
}

/// The local hour (0–23) at `now_ms`.
#[must_use]
pub fn local_hour(now_ms: i64, offset_seconds: i32) -> u8 {
    let local = now_ms.saturating_add(i64::from(offset_seconds) * 1000);
    u8::try_from(local.rem_euclid(DAY_MS) / HOUR_MS).unwrap_or(0)
}

/// Whether the evening wind-down is in force: from the setting's hour until
/// [`WIND_DOWN_END_HOUR`] the next morning.
#[must_use]
pub fn winding_down(hour: u8, settings: &HealthSettings) -> bool {
    settings
        .wind_down_hour
        .is_some_and(|from| hour >= from || hour < WIND_DOWN_END_HOUR)
}

#[derive(Debug, Default)]
pub struct Tracker {
    /// When the current sit began; `None` while away or before the first input.
    sit_start_ms: Option<i64>,
    /// Up to when today's `active_ms` has been credited; `None` while away.
    active_from_ms: Option<i64>,
    /// Why and since when the user is away.
    away: Option<(Away, i64)>,
    last_tick_ms: Option<i64>,
    /// When the next reminder is due; `None` while away.
    remind_at_ms: Option<i64>,
    /// A reminder is up and unanswered since this time.
    break_due_since_ms: Option<i64>,
    flow: Option<RunningFlow>,
    hearing: Hearing,
    /// Today's counters; `dirty` when they changed since the service last saved them.
    today: HealthDayRecord,
    dirty: bool,
}

/// What the hearing clock knows about the default render device and the headphones.
#[derive(Debug, Default, Clone, Copy)]
struct Hearing {
    volume_percent: u8,
    muted: bool,
    headphones: bool,
    /// Loud on headphones since this time.
    loud_since_ms: Option<i64>,
    warned: bool,
}

/// The discrete state the snapshot reflects — everything but the running clocks. The service
/// compares it before and after a step to know whether to publish.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct View {
    pub sit_start_ms: Option<i64>,
    pub away: Option<Away>,
    pub remind_at_ms: Option<i64>,
    pub break_due_since_ms: Option<i64>,
    pub flow: Option<RunningFlow>,
    pub loud_since_ms: Option<i64>,
    pub hearing_warned: bool,
    pub today: HealthDayRecord,
}

impl Tracker {
    /// A tracker for the day starting at `day_start_ms`, continuing `today` when the store had
    /// a record for it. Nobody is sitting yet: the service calls [`Self::come_back`] once it
    /// knows the module is on.
    #[must_use]
    pub fn new(day_start_ms: i64, today: Option<HealthDayRecord>) -> Self {
        Self {
            today: today.unwrap_or(HealthDayRecord {
                day_start_ms,
                ..HealthDayRecord::default()
            }),
            ..Self::default()
        }
    }

    #[must_use]
    pub fn view(&self) -> View {
        View {
            sit_start_ms: self.sit_start_ms,
            away: self.away.map(|(reason, _)| reason),
            remind_at_ms: self.remind_at_ms,
            break_due_since_ms: self.break_due_since_ms,
            flow: self.flow,
            loud_since_ms: self.hearing.loud_since_ms,
            hearing_warned: self.hearing.warned,
            today: self.today,
        }
    }

    #[must_use]
    pub fn today(&self) -> HealthDayRecord {
        self.today
    }

    /// Today's counters with the open sit credited up to `now_ms`.
    #[must_use]
    pub fn today_at(&self, now_ms: i64) -> HealthDayRecord {
        let mut today = self.today;
        if let Some(from) = self.active_from_ms {
            today.active_ms += (now_ms - from).max(0);
        }
        if let Some(sitting) = self.sitting_ms(now_ms) {
            today.longest_sit_ms = today.longest_sit_ms.max(sitting);
        }
        today
    }

    /// Takes the dirty flag: `true` when the counters changed since the last call.
    pub fn take_dirty(&mut self) -> bool {
        std::mem::take(&mut self.dirty)
    }

    /// Adds a stored record for the current day to the counters (the day rolled to one the
    /// store already had — a clock or zone change moved midnight back). Ignored for another
    /// day.
    pub fn merge_today(&mut self, stored: HealthDayRecord) {
        if stored.day_start_ms != self.today.day_start_ms {
            return;
        }
        self.today.active_ms += stored.active_ms;
        self.today.longest_sit_ms = self.today.longest_sit_ms.max(stored.longest_sit_ms);
        self.today.breaks += stored.breaks;
        self.today.water += stored.water;
        self.today.mindful_seconds += stored.mindful_seconds;
        self.today.flows += stored.flows;
        self.dirty = true;
    }

    #[must_use]
    pub fn away(&self) -> Option<Away> {
        self.away.map(|(reason, _)| reason)
    }

    #[must_use]
    pub fn is_sitting(&self) -> bool {
        self.sit_start_ms.is_some() && self.away.is_none()
    }

    #[must_use]
    pub fn sit_start_ms(&self) -> Option<i64> {
        self.sit_start_ms.filter(|_| self.away.is_none())
    }

    /// How long the current sit has lasted at `now_ms`; frozen at the moment the user went
    /// away, `None` when no sit is open.
    #[must_use]
    pub fn sitting_ms(&self, now_ms: i64) -> Option<i64> {
        let start = self.sit_start_ms?;
        let until = self.away.map_or(now_ms, |(_, since)| since);
        Some((until - start).max(0))
    }

    #[must_use]
    pub fn remind_at_ms(&self) -> Option<i64> {
        self.remind_at_ms.filter(|_| self.is_sitting())
    }

    #[must_use]
    pub fn break_due_since_ms(&self) -> Option<i64> {
        self.break_due_since_ms
    }

    #[must_use]
    pub fn flow(&self) -> Option<RunningFlow> {
        self.flow
    }

    #[must_use]
    pub fn loud_since_ms(&self) -> Option<i64> {
        self.hearing.loud_since_ms
    }

    #[must_use]
    pub fn hearing_warned(&self) -> bool {
        self.hearing.warned
    }

    #[must_use]
    pub fn volume(&self) -> (u8, bool) {
        (self.hearing.volume_percent, self.hearing.muted)
    }

    /// The soonest moment something scheduled falls due, for the loop's sleep: the flow's
    /// end, the reminder, the hearing warning. `None` when nothing is scheduled.
    #[must_use]
    pub fn next_deadline_ms(&self, settings: &HealthSettings) -> Option<i64> {
        let mut soonest: Option<i64> = None;
        let mut consider = |at: Option<i64>| {
            if let Some(at) = at {
                soonest = Some(soonest.map_or(at, |s| s.min(at)));
            }
        };
        consider(self.flow.map(|flow| flow.ends_ms()));
        if self.flow.is_none() && self.break_due_since_ms.is_none() {
            consider(self.remind_at_ms());
        }
        if settings.hearing_warning && !self.hearing.warned {
            consider(
                self.hearing
                    .loud_since_ms
                    .map(|since| since + LOUD_AFTER_MS),
            );
        }
        soonest
    }

    // --- inputs -------------------------------------------------------------------------------

    /// One step, every [`super::TICK`] and at every deadline. `idle_ms` is how long the input
    /// has been idle; `suppressed` says a fullscreen app or a presentation is in front, so a
    /// reminder that falls due waits [`DEFER_MS`] rather than fire unseen.
    pub fn tick(
        &mut self,
        now_ms: i64,
        idle_ms: i64,
        day_start_ms: i64,
        suppressed: bool,
        settings: &HealthSettings,
    ) -> Vec<Effect> {
        let mut effects = Vec::new();
        if let Some(last) = self.last_tick_ms
            && now_ms - last > SLEEP_GAP_MS
            && self.away.is_none()
        {
            // The machine slept: the sit ended at the last tick, and a flow cannot have run.
            if self.flow.take().is_some() {
                effects.push(Effect::FlowStopped);
            }
            effects.extend(self.go_away(Away::Asleep, last));
        }
        self.last_tick_ms = Some(now_ms);

        if self.today.day_start_ms != day_start_ms {
            effects.extend(self.roll_day(day_start_ms));
        }

        if !settings.enabled {
            return effects;
        }

        match self.away {
            Some((Away::Idle | Away::Asleep, _)) if idle_ms < AWAY_AFTER_MS => {
                effects.extend(self.come_back(now_ms - idle_ms.max(0), settings));
            }
            // A flow is time away from the keyboard by design; idle does not end the sit then.
            None if self.flow.is_none() && idle_ms >= AWAY_AFTER_MS => {
                effects.extend(self.go_away(Away::Idle, now_ms - idle_ms));
            }
            // Locked and off end only through their own events.
            _ => {}
        }

        if let Some(flow) = self.flow
            && now_ms >= flow.ends_ms()
        {
            effects.extend(self.finish_flow(flow, now_ms, settings));
        }

        if self.is_sitting()
            && self.flow.is_none()
            && self.break_due_since_ms.is_none()
            && let Some(due) = self.remind_at_ms
            && now_ms >= due
        {
            if suppressed {
                self.remind_at_ms = Some(now_ms + DEFER_MS);
            } else {
                self.break_due_since_ms = Some(now_ms);
                self.remind_at_ms = Some(now_ms + interval_ms(settings));
                let minutes = self.sitting_ms(now_ms).unwrap_or(0) / MINUTE_MS;
                effects.push(Effect::RemindBreak {
                    minutes: u32::try_from(minutes).unwrap_or(u32::MAX),
                });
            }
        }

        if settings.hearing_warning
            && !self.hearing.warned
            && let Some(since) = self.hearing.loud_since_ms
            && now_ms - since >= LOUD_AFTER_MS
        {
            self.hearing.warned = true;
            effects.push(Effect::HearingWarning {
                percent: self.hearing.volume_percent,
                minutes: u32::try_from((now_ms - since) / MINUTE_MS).unwrap_or(u32::MAX),
            });
        }

        if let Some(from) = self.active_from_ms
            && now_ms - from >= CREDIT_EVERY_MS
        {
            self.credit_active(now_ms);
            self.active_from_ms = Some(now_ms);
        }
        effects
    }

    /// The session locked or unlocked at `now_ms`.
    pub fn set_locked(
        &mut self,
        locked: bool,
        now_ms: i64,
        settings: &HealthSettings,
    ) -> Vec<Effect> {
        if locked {
            let mut effects = Vec::new();
            match self.away {
                Some((Away::Locked | Away::Off, _)) => {}
                // Already away: the lock only changes why.
                Some((_, since)) => self.away = Some((Away::Locked, since)),
                None => {
                    if self.flow.take().is_some() {
                        effects.push(Effect::FlowStopped);
                    }
                    effects.extend(self.go_away(Away::Locked, now_ms));
                }
            }
            effects
        } else if matches!(self.away, Some((Away::Locked, _))) && settings.enabled {
            self.come_back(now_ms, settings)
        } else {
            Vec::new()
        }
    }

    /// The module was turned on or off (a settings change, or start-up with it on).
    pub fn set_enabled(
        &mut self,
        enabled: bool,
        now_ms: i64,
        settings: &HealthSettings,
    ) -> Vec<Effect> {
        if enabled {
            match self.away {
                Some((Away::Off, _)) => self.come_back(now_ms, settings),
                // Start-up: nobody has sat down yet.
                None if self.sit_start_ms.is_none() => self.come_back(now_ms, settings),
                _ => Vec::new(),
            }
        } else {
            let mut effects = Vec::new();
            if self.flow.take().is_some() {
                effects.push(Effect::FlowStopped);
            }
            match self.away {
                Some((Away::Off, _)) => {}
                Some((_, since)) => self.away = Some((Away::Off, since)),
                None => effects.extend(self.go_away(Away::Off, now_ms)),
            }
            effects
        }
    }

    /// The reminder interval changed: an open sit takes it from its start.
    pub fn apply_interval(&mut self, settings: &HealthSettings) {
        if let Some(start) = self.sit_start_ms
            && self.break_due_since_ms.is_none()
        {
            self.remind_at_ms = Some(start + interval_ms(settings));
        }
    }

    /// Starts `flow` at `now_ms`, replacing a running one. The reminder it answers goes.
    pub fn start_flow(
        &mut self,
        flow: HealthFlow,
        now_ms: i64,
        settings: &HealthSettings,
    ) -> Vec<Effect> {
        let mut effects = Vec::new();
        if self.break_due_since_ms.take().is_some() {
            effects.push(Effect::RetractBreak);
        }
        self.flow = Some(RunningFlow {
            flow,
            started_ms: now_ms,
            total_ms: flow_total_ms(flow, settings.breathe_pattern),
        });
        effects.push(Effect::FlowStarted);
        effects
    }

    /// The user stopped the flow early. Breathing done so far still counts as mindful time.
    pub fn stop_flow(&mut self, now_ms: i64) -> Vec<Effect> {
        let Some(flow) = self.flow.take() else {
            return Vec::new();
        };
        if flow.flow == HealthFlow::Breathe {
            let elapsed = (now_ms - flow.started_ms).clamp(0, i64::from(flow.total_ms));
            self.today.mindful_seconds += u32::try_from(elapsed / 1000).unwrap_or(0);
            self.dirty = true;
        }
        vec![Effect::FlowStopped]
    }

    /// *Snooze* on the reminder: again in [`SNOOZE_MS`].
    pub fn snooze(&mut self, now_ms: i64) -> Vec<Effect> {
        if self.break_due_since_ms.take().is_none() {
            return Vec::new();
        }
        self.remind_at_ms = Some(now_ms + SNOOZE_MS);
        vec![Effect::RetractBreak]
    }

    /// *Dismiss* on the reminder: the next one comes a full interval after this one did.
    pub fn dismiss(&mut self) -> Vec<Effect> {
        if self.break_due_since_ms.take().is_none() {
            return Vec::new();
        }
        vec![Effect::RetractBreak]
    }

    /// Logs `delta` glasses of water (negative to undo), 0–99.
    pub fn water(&mut self, delta: i32) {
        let next = i32::try_from(self.today.water)
            .unwrap_or(i32::MAX)
            .saturating_add(delta)
            .clamp(0, 99);
        self.today.water = u32::try_from(next).unwrap_or(0);
        self.dirty = true;
    }

    /// *Reset today*: the counters go back to zero and the sit starts over now.
    pub fn reset(&mut self, now_ms: i64, settings: &HealthSettings) -> Vec<Effect> {
        let mut effects = Vec::new();
        if self.flow.take().is_some() {
            effects.push(Effect::FlowStopped);
        }
        self.today = HealthDayRecord {
            day_start_ms: self.today.day_start_ms,
            ..HealthDayRecord::default()
        };
        self.dirty = true;
        if self.is_sitting() {
            effects.extend(self.start_sit(now_ms, settings));
        }
        effects
    }

    /// The default render device's level changed.
    pub fn set_volume(&mut self, percent: u8, muted: bool, now_ms: i64) {
        self.hearing.volume_percent = percent;
        self.hearing.muted = muted;
        self.update_loud(now_ms);
    }

    /// Whether headphones are in use, as far as the service can tell.
    pub fn set_headphones(&mut self, headphones: bool, now_ms: i64) {
        self.hearing.headphones = headphones;
        self.update_loud(now_ms);
    }

    // --- internals ---------------------------------------------------------------------------

    fn update_loud(&mut self, now_ms: i64) {
        let hearing = &mut self.hearing;
        let loud = hearing.headphones && !hearing.muted && hearing.volume_percent > LOUD_PERCENT;
        if loud {
            hearing.loud_since_ms.get_or_insert(now_ms);
        } else {
            hearing.loud_since_ms = None;
            hearing.warned = false;
        }
    }

    /// The user is away from `at_ms` for `reason`. The sit is not over yet: a short absence
    /// is skipped when they come back.
    fn go_away(&mut self, reason: Away, at_ms: i64) -> Vec<Effect> {
        if self.away.is_some() {
            return Vec::new();
        }
        self.credit_active(at_ms);
        self.active_from_ms = None;
        self.away = Some((reason, at_ms));
        let mut effects = Vec::new();
        if self.break_due_since_ms.take().is_some() {
            // They got up: that answers the reminder.
            effects.push(Effect::RetractBreak);
        }
        effects
    }

    /// Input resumed at `at_ms`. A long absence ends the sit that preceded it (a break, when
    /// the sit was long enough) and opens a new one; a short one is skipped over.
    fn come_back(&mut self, at_ms: i64, settings: &HealthSettings) -> Vec<Effect> {
        let Some((reason, since)) = self.away.take() else {
            return if self.sit_start_ms.is_none() {
                self.start_sit(at_ms, settings)
            } else {
                Vec::new()
            };
        };
        let absent_ms = (at_ms - since).max(0);
        let ends_sit = absent_ms >= AWAY_AFTER_MS || matches!(reason, Away::Asleep);
        if ends_sit || self.sit_start_ms.is_none() {
            self.end_sit(since, true);
            return self.start_sit(at_ms, settings);
        }
        // Skip the absence: the sit continues as if it never happened.
        self.sit_start_ms = self.sit_start_ms.map(|start| start + absent_ms);
        self.remind_at_ms = self.remind_at_ms.map(|at| at + absent_ms);
        self.active_from_ms = Some(at_ms);
        Vec::new()
    }

    fn start_sit(&mut self, at_ms: i64, settings: &HealthSettings) -> Vec<Effect> {
        self.sit_start_ms = Some(at_ms);
        self.active_from_ms = Some(at_ms);
        self.remind_at_ms = Some(at_ms + interval_ms(settings));
        if self.break_due_since_ms.take().is_some() {
            vec![Effect::RetractBreak]
        } else {
            Vec::new()
        }
    }

    /// Closes the open sit at `at_ms`: the longest-sit record, and a break when the sit was
    /// long enough and `count_break` says the absence was one.
    fn end_sit(&mut self, at_ms: i64, count_break: bool) {
        let Some(start) = self.sit_start_ms.take() else {
            return;
        };
        self.credit_active(at_ms);
        self.active_from_ms = None;
        let length = (at_ms - start).max(0);
        self.today.longest_sit_ms = self.today.longest_sit_ms.max(length);
        if count_break && length >= MIN_SIT_FOR_BREAK_MS {
            self.today.breaks += 1;
        }
        self.remind_at_ms = None;
        self.dirty = true;
    }

    fn credit_active(&mut self, until_ms: i64) {
        if let Some(from) = self.active_from_ms {
            let credit = (until_ms - from).max(0);
            if credit > 0 {
                self.today.active_ms += credit;
                self.dirty = true;
            }
        }
    }

    fn finish_flow(
        &mut self,
        flow: RunningFlow,
        now_ms: i64,
        settings: &HealthSettings,
    ) -> Vec<Effect> {
        self.flow = None;
        self.today.flows += 1;
        if flow.flow == HealthFlow::Breathe {
            self.today.mindful_seconds += flow.total_ms / 1000;
        }
        self.dirty = true;
        let mut effects = vec![Effect::FlowFinished(flow.flow)];
        if flow.flow.counts_as_break() && self.away.is_none() {
            // They were on their feet since the flow started: that sit is over, this is a
            // break, and a fresh sit starts now.
            self.end_sit(flow.started_ms, false);
            self.today.breaks += 1;
            effects.extend(self.start_sit(now_ms, settings));
        }
        effects
    }

    /// Midnight passed: close yesterday's record and start today's; an open sit carries on.
    fn roll_day(&mut self, day_start_ms: i64) -> Vec<Effect> {
        let boundary = day_start_ms.max(self.today.day_start_ms);
        if let Some(from) = self.active_from_ms
            && from < boundary
        {
            self.today.active_ms += boundary - from;
            self.active_from_ms = Some(boundary);
        }
        if let Some(start) = self.sit_start_ms
            && self.away.is_none()
        {
            self.today.longest_sit_ms = self.today.longest_sit_ms.max(boundary - start);
        }
        let closed = self.today;
        self.today = HealthDayRecord {
            day_start_ms,
            ..HealthDayRecord::default()
        };
        self.dirty = true;
        vec![Effect::DayClosed(closed)]
    }
}

fn interval_ms(settings: &HealthSettings) -> i64 {
    i64::from(settings.break_every_min) * MINUTE_MS
}
