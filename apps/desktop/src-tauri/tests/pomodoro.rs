//! The `pomodoro` module against `FakeClock` and an in-memory store (docs/modules/pomodoro.md
//! acceptance criteria, docs/build-plan/m3-daily-modules.md E3). Integration tests because the
//! `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked tests).

use std::sync::Arc;
use std::time::Duration;

use muna_core::activities::NOTICE_HOLD;
use muna_core::{
    Clock, FakeClock, Glyph, Hub, Leading, PomodoroPhase, Settings, Store, StripContent,
    StripMessage, StripSink, Tint, Trailing,
};
use muna_lib::modules::pomodoro::{
    ACTIVITY_ID, FINISHED_NOTICE_ID, PomodoroCommand, PomodoroFinished, PomodoroService,
    PomodoroSettings, PomodoroSink, PomodoroState, PomodoroStatus, REPUBLISH, TICK,
    settings::{LONG_BREAK_EVERY, LONG_BREAK_MINUTES, SHORT_BREAK_MINUTES, WORK_MINUTES},
};
use parking_lot::Mutex;

const MINUTE: Duration = Duration::from_secs(60);

#[derive(Default)]
struct Recorder {
    states: Mutex<Vec<PomodoroState>>,
    strip: Mutex<Vec<StripContent>>,
}

impl PomodoroSink for Recorder {
    fn state_changed(&self, state: &PomodoroState) {
        self.states.lock().push(state.clone());
    }
}

impl StripSink for Recorder {
    fn strip_changed(&self, content: &StripContent) {
        self.strip.lock().push(content.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    hub: Arc<Hub>,
    service: Arc<PomodoroService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_settings(&PomodoroSettings::default())
    }

    fn with_settings(settings: &PomodoroSettings) -> Self {
        let clock = Arc::new(FakeClock::new());
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let store = Arc::new(Store::open_in_memory().expect("in-memory store"));
        let service = Arc::new(PomodoroService::new(
            Arc::clone(&hub),
            store,
            Arc::clone(&clock) as Arc<dyn Clock>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn PomodoroSink>);
        hub.add_sink(Arc::clone(&recorder) as Arc<dyn StripSink>);
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        service.apply_settings(&document);
        Self {
            clock,
            hub,
            service,
            recorder,
        }
    }

    /// Lets `by` pass the way the backend loop would see it: one tick per [`TICK`].
    fn run_for(&self, by: Duration) -> Vec<muna_lib::modules::pomodoro::Run> {
        let mut finished = Vec::new();
        let mut left = by;
        while !left.is_zero() {
            let step = left.min(TICK);
            self.clock.advance(step);
            left -= step;
            if let Some(run) = self.service.tick() {
                finished.push(run);
            }
        }
        finished
    }

    fn start(&self, phase: Option<PomodoroPhase>) -> PomodoroState {
        self.service.command(PomodoroCommand::Start { phase })
    }

    fn state(&self) -> PomodoroState {
        self.service.state()
    }

    fn strip_activity(&self) -> Option<muna_core::Activity> {
        self.hub
            .activities()
            .into_iter()
            .map(|held| held.activity)
            .find(|activity| activity.id == ACTIVITY_ID)
    }

    fn shown_notice(&self) -> Option<muna_core::Notice> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice),
            _ => None,
        }
    }
}

fn timer(remaining_ms: u32, total_ms: u32, running: bool) -> Trailing {
    Trailing::Timer {
        remaining_ms,
        total_ms,
        running,
    }
}

fn ms(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).expect("fits")
}

// --- idle ------------------------------------------------------------------------------------

#[test]
fn a_fresh_timer_is_idle_at_a_full_work_phase_and_needs_no_wake_ups() {
    let rig = Rig::new();
    let state = rig.state();
    assert_eq!(state.phase, PomodoroPhase::Work);
    assert_eq!(state.status, PomodoroStatus::Idle);
    assert_eq!(state.remaining_ms, ms(25 * MINUTE));
    assert_eq!(state.total_ms, ms(25 * MINUTE));
    assert_eq!(state.completed_in_cycle, 0);
    assert_eq!(state.cycle_length, 4);
    assert_eq!(state.sessions_today, 0);
    assert_eq!(state.last_finished, None);
    assert_eq!(
        rig.hub.current(),
        StripContent::Idle,
        "nothing in the strip"
    );
    assert_eq!(
        rig.service.next_wake(),
        None,
        "an idle timer runs no timers (perf budget)"
    );
}

// --- start / countdown -----------------------------------------------------------------------

#[test]
fn start_puts_a_running_countdown_in_the_strip_and_arms_the_tick() {
    let rig = Rig::new();
    let state = rig.start(None);
    assert_eq!(state.status, PomodoroStatus::Running);
    assert_eq!(state.remaining_ms, ms(25 * MINUTE));

    let activity = rig.strip_activity().expect("activity published");
    assert_eq!(activity.module, "pomodoro");
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(Tint::Orange),
        }),
        "work is the warm accent"
    );
    assert_eq!(
        activity.trailing,
        Some(timer(ms(25 * MINUTE), ms(25 * MINUTE), true))
    );
    assert_eq!(
        activity.wide,
        Some(StripMessage::Pomodoro {
            phase: PomodoroPhase::Work,
        })
    );
    assert!(
        matches!(rig.hub.current(), StripContent::Activity { .. }),
        "the strip shows the countdown"
    );
    assert_eq!(rig.service.next_wake(), Some(TICK));
    assert_eq!(
        rig.recorder.states.lock().len(),
        1,
        "one state per command (the settings applied by the rig were the defaults)"
    );
}

#[test]
fn the_countdown_follows_the_monotonic_clock_without_drift() {
    let rig = Rig::new();
    rig.start(None);
    let finished = rig.run_for(24 * MINUTE + Duration::from_secs(59));
    assert!(finished.is_empty());
    assert_eq!(
        rig.state().remaining_ms,
        1000,
        "1 s left after 24:59 of a 25 min phase; no drift accumulates"
    );
    assert_eq!(
        rig.service.next_wake(),
        Some(Duration::from_secs(1)),
        "the loop wakes at the deadline, not at the next 5 s tick"
    );
}

#[test]
fn the_strip_countdown_is_republished_once_a_minute_while_running() {
    let rig = Rig::new();
    rig.start(None);
    let before = rig.recorder.strip.lock().len();
    rig.run_for(REPUBLISH.saturating_sub(TICK));
    assert_eq!(
        rig.recorder.strip.lock().len(),
        before,
        "no strip traffic between republishes"
    );
    rig.run_for(TICK);
    let after_one_minute = rig.recorder.strip.lock().len();
    assert_eq!(after_one_minute, before + 1, "republished at 60 s");
    let activity = rig.strip_activity().expect("still published");
    assert_eq!(
        activity.trailing,
        Some(timer(ms(24 * MINUTE), ms(25 * MINUTE), true)),
        "the republished countdown carries the corrected remaining time"
    );
    rig.run_for(REPUBLISH);
    assert_eq!(
        rig.recorder.strip.lock().len(),
        after_one_minute + 1,
        "and again at 120 s"
    );
}

// --- finishing -------------------------------------------------------------------------------

#[test]
fn a_work_phase_that_runs_out_moves_to_a_short_break_and_announces_it() {
    let rig = Rig::new();
    rig.start(None);
    let finished = rig.run_for(25 * MINUTE);
    assert_eq!(finished.len(), 1);
    let run = finished[0];
    assert_eq!(run.phase, PomodoroPhase::Work);
    assert!(run.completed);
    assert!(!run.while_asleep);
    assert_eq!(
        run.ended_wall.duration_since(run.started_wall).unwrap(),
        25 * MINUTE
    );

    let state = rig.state();
    assert_eq!(state.phase, PomodoroPhase::ShortBreak);
    assert_eq!(state.status, PomodoroStatus::Idle, "auto-start is off");
    assert_eq!(state.remaining_ms, ms(5 * MINUTE));
    assert_eq!(state.total_ms, ms(5 * MINUTE));
    assert_eq!(state.completed_in_cycle, 1);
    assert_eq!(
        state.sessions_today, 1,
        "the completed work phase is logged"
    );
    assert_eq!(
        state.last_finished,
        Some(PomodoroFinished {
            phase: PomodoroPhase::Work,
            while_asleep: false,
        })
    );

    let notice = rig
        .shown_notice()
        .expect("the finished notice holds the strip");
    assert_eq!(notice.id, FINISHED_NOTICE_ID);
    assert_eq!(
        notice.wide,
        Some(StripMessage::PomodoroFinished {
            phase: PomodoroPhase::Work,
        })
    );
    assert_eq!(notice.hold(), NOTICE_HOLD, "the default 4 s hold");
    assert_eq!(rig.strip_activity(), None, "the countdown left the strip");
    assert_eq!(rig.service.next_wake(), None, "idle again: no timers");

    rig.clock.advance(NOTICE_HOLD);
    assert_eq!(rig.hub.refresh(), StripContent::Idle);
}

#[test]
fn the_last_work_phase_of_a_cycle_earns_a_long_break_and_resets_the_count() {
    let rig = Rig::new();
    for round in 1..=4_u8 {
        rig.start(None);
        assert_eq!(rig.state().phase, PomodoroPhase::Work);
        rig.run_for(25 * MINUTE);
        let state = rig.state();
        assert_eq!(state.completed_in_cycle, round);
        if round < 4 {
            assert_eq!(state.phase, PomodoroPhase::ShortBreak, "round {round}");
            rig.start(None);
            rig.run_for(5 * MINUTE);
            assert_eq!(rig.state().phase, PomodoroPhase::Work);
        } else {
            assert_eq!(state.phase, PomodoroPhase::LongBreak);
            assert_eq!(state.total_ms, ms(15 * MINUTE));
        }
    }
    rig.start(None);
    let finished = rig.run_for(15 * MINUTE);
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].phase, PomodoroPhase::LongBreak);
    let state = rig.state();
    assert_eq!(state.phase, PomodoroPhase::Work);
    assert_eq!(state.completed_in_cycle, 0, "a new cycle");
    assert_eq!(
        state.sessions_today, 4,
        "breaks are logged but only work phases count as sessions"
    );
}

#[test]
fn auto_start_runs_the_next_phase_without_a_gap() {
    let rig = Rig::with_settings(&PomodoroSettings {
        auto_start_next: true,
        ..PomodoroSettings::default()
    });
    rig.start(None);
    rig.run_for(25 * MINUTE);
    let state = rig.state();
    assert_eq!(state.phase, PomodoroPhase::ShortBreak);
    assert_eq!(state.status, PomodoroStatus::Running);
    assert_eq!(state.remaining_ms, ms(5 * MINUTE));
    assert_eq!(
        state.last_finished.map(|f| f.phase),
        Some(PomodoroPhase::Work)
    );
    let activity = rig
        .strip_activity()
        .expect("the break countdown is published");
    assert_eq!(
        activity.leading,
        Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(Tint::Green),
        }),
        "breaks are green"
    );
    assert!(
        rig.shown_notice().is_some(),
        "the finished notice still shows over the new countdown"
    );
    assert_eq!(rig.service.next_wake(), Some(TICK));
}

// --- sleep -----------------------------------------------------------------------------------

#[test]
fn a_deadline_that_passed_while_the_machine_slept_is_reported_as_such() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(10 * MINUTE);
    rig.clock.sleep(20 * MINUTE);
    let run = rig.service.tick().expect("finished while asleep");
    assert!(run.completed);
    assert!(run.while_asleep);
    assert_eq!(
        rig.state().last_finished,
        Some(PomodoroFinished {
            phase: PomodoroPhase::Work,
            while_asleep: true,
        })
    );
    assert_eq!(rig.state().sessions_today, 1, "it still counts");
    assert_eq!(
        rig.shown_notice().map(|n| n.id),
        Some(FINISHED_NOTICE_ID.into())
    );
}

#[test]
fn a_sleep_before_the_deadline_re_anchors_the_countdown_to_the_wall_clock() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(5 * MINUTE);
    rig.clock.sleep(10 * MINUTE);
    assert_eq!(
        rig.state().remaining_ms,
        ms(10 * MINUTE),
        "the wall clock is trusted when the clocks disagree"
    );
    assert_eq!(rig.service.tick(), None);
    let finished = rig.run_for(10 * MINUTE);
    assert_eq!(finished.len(), 1);
    assert!(
        !finished[0].while_asleep,
        "the deadline was met awake after the re-anchor"
    );
}

#[test]
fn a_tick_that_fires_long_after_the_deadline_counts_as_finished_while_asleep() {
    let rig = Rig::new();
    rig.start(None);
    // Both clocks agree but nobody was there to see the deadline pass.
    rig.clock.advance(25 * MINUTE + Duration::from_secs(6));
    let run = rig.service.tick().expect("finished");
    assert!(run.while_asleep);
}

// --- pause / resume / reset / skip -----------------------------------------------------------

#[test]
fn pause_freezes_the_countdown_and_resume_continues_it() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(10 * MINUTE);
    let paused = rig.service.command(PomodoroCommand::Pause);
    assert_eq!(paused.status, PomodoroStatus::Paused);
    assert_eq!(paused.remaining_ms, ms(15 * MINUTE));
    assert_eq!(
        rig.strip_activity().and_then(|a| a.trailing),
        Some(timer(ms(15 * MINUTE), ms(25 * MINUTE), false)),
        "the strip shows a frozen countdown"
    );
    assert_eq!(rig.service.next_wake(), None, "paused runs no timers");

    rig.clock.advance(30 * MINUTE);
    assert_eq!(rig.service.tick(), None);
    assert_eq!(rig.state().remaining_ms, ms(15 * MINUTE), "still frozen");

    let resumed = rig.service.command(PomodoroCommand::Resume);
    assert_eq!(resumed.status, PomodoroStatus::Running);
    assert_eq!(resumed.remaining_ms, ms(15 * MINUTE));
    assert!(rig.run_for((15 * MINUTE).saturating_sub(TICK)).is_empty());
    let finished = rig.run_for(TICK);
    assert_eq!(finished.len(), 1);
    assert_eq!(
        finished[0]
            .ended_wall
            .duration_since(finished[0].started_wall)
            .unwrap(),
        55 * MINUTE,
        "the logged run spans the pause"
    );
}

#[test]
fn pause_and_resume_are_ignored_when_they_do_not_apply() {
    let rig = Rig::new();
    let before = rig.state();
    assert_eq!(rig.service.command(PomodoroCommand::Pause), before);
    assert_eq!(rig.service.command(PomodoroCommand::Resume), before);
    assert_eq!(rig.hub.current(), StripContent::Idle);
}

#[test]
fn reset_goes_back_to_the_top_of_the_phase_and_logs_the_abandoned_run() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(10 * MINUTE);
    let state = rig.service.command(PomodoroCommand::Reset);
    assert_eq!(state.phase, PomodoroPhase::Work);
    assert_eq!(state.status, PomodoroStatus::Idle);
    assert_eq!(state.remaining_ms, ms(25 * MINUTE));
    assert_eq!(state.completed_in_cycle, 0);
    assert_eq!(
        state.sessions_today, 0,
        "an abandoned work phase is not a session"
    );
    assert_eq!(
        rig.hub.current(),
        StripContent::Idle,
        "the countdown left the strip"
    );
    assert_eq!(rig.service.next_wake(), None);
}

#[test]
fn skip_moves_on_without_counting_the_work_phase() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(MINUTE);
    let state = rig.service.command(PomodoroCommand::Skip);
    assert_eq!(state.phase, PomodoroPhase::ShortBreak);
    assert_eq!(state.status, PomodoroStatus::Idle);
    assert_eq!(state.remaining_ms, ms(5 * MINUTE));
    assert_eq!(
        state.completed_in_cycle, 0,
        "skipped work does not earn a break"
    );
    assert_eq!(state.sessions_today, 0);
    assert_eq!(rig.hub.current(), StripContent::Idle);

    let state = rig.service.command(PomodoroCommand::Skip);
    assert_eq!(
        state.phase,
        PomodoroPhase::Work,
        "skipping a break goes back to work"
    );
}

#[test]
fn skipping_a_long_break_starts_a_new_cycle() {
    let rig = Rig::with_settings(&PomodoroSettings {
        long_break_every: 2,
        ..PomodoroSettings::default()
    });
    for _ in 0..2 {
        rig.start(None);
        rig.run_for(25 * MINUTE);
        if rig.state().phase == PomodoroPhase::ShortBreak {
            rig.service.command(PomodoroCommand::Skip);
        }
    }
    assert_eq!(rig.state().phase, PomodoroPhase::LongBreak);
    assert_eq!(rig.state().completed_in_cycle, 2);
    let state = rig.service.command(PomodoroCommand::Skip);
    assert_eq!(state.phase, PomodoroPhase::Work);
    assert_eq!(state.completed_in_cycle, 0);
}

// --- presets ---------------------------------------------------------------------------------

#[test]
fn a_preset_picks_the_phase_while_idle_and_start_restarts_while_running() {
    let rig = Rig::new();
    let state = rig.start(Some(PomodoroPhase::LongBreak));
    assert_eq!(state.phase, PomodoroPhase::LongBreak);
    assert_eq!(state.status, PomodoroStatus::Running);
    assert_eq!(state.total_ms, ms(15 * MINUTE));
    rig.run_for(5 * MINUTE);

    // The presets are disabled while running; a stray start restarts the current phase.
    let state = rig.start(Some(PomodoroPhase::Work));
    assert_eq!(
        state.phase,
        PomodoroPhase::LongBreak,
        "the phase did not change"
    );
    assert_eq!(state.remaining_ms, ms(15 * MINUTE), "from the top");
    assert_eq!(state.sessions_today, 0);

    rig.service.command(PomodoroCommand::Reset);
    let state = rig.start(Some(PomodoroPhase::Work));
    assert_eq!(state.phase, PomodoroPhase::Work);
    assert_eq!(state.total_ms, ms(25 * MINUTE));
}

#[test]
fn select_picks_a_preset_without_starting_it_and_only_while_idle() {
    let rig = Rig::new();
    let state = rig.service.command(PomodoroCommand::Select {
        phase: PomodoroPhase::ShortBreak,
    });
    assert_eq!(state.phase, PomodoroPhase::ShortBreak);
    assert_eq!(state.status, PomodoroStatus::Idle);
    assert_eq!(state.remaining_ms, ms(5 * MINUTE));
    assert_eq!(rig.hub.current(), StripContent::Idle, "nothing runs yet");

    rig.start(None);
    let state = rig.service.command(PomodoroCommand::Select {
        phase: PomodoroPhase::Work,
    });
    assert_eq!(
        state.phase,
        PomodoroPhase::ShortBreak,
        "ignored while running"
    );
    assert_eq!(state.status, PomodoroStatus::Running);
}

#[test]
fn a_new_command_clears_the_last_finished_notice_text() {
    let rig = Rig::new();
    rig.start(None);
    rig.run_for(25 * MINUTE);
    assert!(rig.state().last_finished.is_some());
    let state = rig.start(None);
    assert_eq!(state.last_finished, None);
}

// --- settings --------------------------------------------------------------------------------

#[test]
fn settings_resize_an_idle_phase_at_once_but_never_a_running_one() {
    let rig = Rig::new();
    let mut document = Settings::default();
    PomodoroSettings {
        work_minutes: 50,
        ..PomodoroSettings::default()
    }
    .write(&mut document)
    .unwrap();
    rig.service.apply_settings(&document);
    let state = rig.state();
    assert_eq!(state.total_ms, ms(50 * MINUTE));
    assert_eq!(state.remaining_ms, ms(50 * MINUTE));
    assert_eq!(
        rig.recorder.states.lock().last().map(|s| s.total_ms),
        Some(ms(50 * MINUTE)),
        "the panel hears about the new length"
    );

    rig.start(None);
    rig.run_for(10 * MINUTE);
    PomodoroSettings {
        work_minutes: 30,
        long_break_every: 3,
        ..PomodoroSettings::default()
    }
    .write(&mut document)
    .unwrap();
    rig.service.apply_settings(&document);
    let state = rig.state();
    assert_eq!(
        state.total_ms,
        ms(50 * MINUTE),
        "the running phase keeps its length"
    );
    assert_eq!(state.remaining_ms, ms(40 * MINUTE));
    assert_eq!(state.cycle_length, 3, "but the cycle length is live");

    rig.run_for(40 * MINUTE);
    rig.service.command(PomodoroCommand::Skip);
    assert_eq!(rig.state().phase, PomodoroPhase::Work);
    assert_eq!(
        rig.state().total_ms,
        ms(30 * MINUTE),
        "the next work phase is 30 min"
    );
}

#[test]
fn unchanged_settings_do_not_republish() {
    let rig = Rig::new();
    let before = rig.recorder.states.lock().len();
    rig.service.apply_settings(&Settings::default());
    assert_eq!(rig.recorder.states.lock().len(), before);
}

#[test]
fn settings_are_clamped_to_the_documented_bounds() {
    let mut document = Settings::default();
    document.modules.insert(
        PomodoroSettings::KEY.to_owned(),
        serde_json::json!({
            "workMinutes": 500,
            "shortBreakMinutes": 0,
            "longBreakMinutes": 1000,
            "longBreakEvery": 1,
            "autoStartNext": true,
            "someFutureKey": "ignored"
        }),
    );
    let settings = PomodoroSettings::from_document(&document);
    assert_eq!(settings.work_minutes, WORK_MINUTES.1);
    assert_eq!(settings.short_break_minutes, SHORT_BREAK_MINUTES.0);
    assert_eq!(settings.long_break_minutes, LONG_BREAK_MINUTES.1);
    assert_eq!(settings.long_break_every, LONG_BREAK_EVERY.0);
    assert!(settings.auto_start_next);
}

#[test]
fn malformed_or_missing_settings_fall_back_to_the_defaults() {
    assert_eq!(
        PomodoroSettings::from_document(&Settings::default()),
        PomodoroSettings::default()
    );
    let mut document = Settings::default();
    document.modules.insert(
        PomodoroSettings::KEY.to_owned(),
        serde_json::json!("not an object"),
    );
    assert_eq!(
        PomodoroSettings::from_document(&document),
        PomodoroSettings::default()
    );
    let mut partial = Settings::default();
    partial.modules.insert(
        PomodoroSettings::KEY.to_owned(),
        serde_json::json!({ "workMinutes": 45 }),
    );
    assert_eq!(
        PomodoroSettings::from_document(&partial),
        PomodoroSettings {
            work_minutes: 45,
            ..PomodoroSettings::default()
        },
        "missing keys keep their defaults"
    );
}

#[test]
fn settings_round_trip_through_the_document() {
    let settings = PomodoroSettings {
        work_minutes: 40,
        short_break_minutes: 8,
        long_break_minutes: 20,
        long_break_every: 3,
        auto_start_next: true,
    };
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    assert_eq!(PomodoroSettings::from_document(&document), settings);
}
