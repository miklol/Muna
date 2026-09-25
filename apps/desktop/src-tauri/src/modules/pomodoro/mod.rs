//! The `pomodoro` module backend (docs/modules/pomodoro.md): a focus/break cycle timed in
//! Rust, shown in the strip as a live countdown, announced with a notice when a phase runs
//! out, and logged so the panel can say how many sessions were done today.
//!
//! [`PomodoroService`] is the shared object: the IPC commands drive it, the backend runs its
//! tick loop, and it tells a [`PomodoroSink`] whenever its state changed. Everything that
//! reasons about time is synchronous and takes the clock as an argument, so `tests/pomodoro.rs`
//! drives it with a `FakeClock`.

pub mod settings;
pub mod timer;

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Glyph, Hub, Leading, Notice, PomodoroPhase, PomodoroSessionRecord, Settings,
    Store, StripMessage, Tint, Trailing, activities::priority,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use settings::PomodoroSettings;
pub use timer::{Now, PomodoroFinished, PomodoroStatus, PomodoroTimer, Run};

pub const ID: &str = "pomodoro";
pub const ACTIVITY_ID: &str = "pomodoro:timer";
pub const FINISHED_NOTICE_ID: &str = "pomodoro:finished";

/// How often a running timer is checked for its deadline and for a sleep the monotonic clock
/// missed. The UI counts down locally between checks; this is not a render cadence.
pub const TICK: Duration = Duration::from_secs(5);
/// How often the strip activity is republished while running, so a drifted UI countdown is
/// corrected (docs/modules/pomodoro.md, "drift ≤ 1 s over 25 min").
pub const REPUBLISH: Duration = Duration::from_secs(60);

/// What the UI renders (docs/modules/pomodoro.md). `remaining_ms` is exact at the moment the
/// state was produced; the UI counts down from it while `status` is `running`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroState {
    pub phase: PomodoroPhase,
    pub status: PomodoroStatus,
    pub remaining_ms: u32,
    pub total_ms: u32,
    /// Work phases completed since the last long break.
    pub completed_in_cycle: u8,
    /// Work phases per cycle (`settings.modules.pomodoro.longBreakEvery`).
    pub cycle_length: u8,
    /// Completed work phases that ended today, local time.
    pub sessions_today: u32,
    /// The phase that ran out most recently; cleared by the next command.
    pub last_finished: Option<PomodoroFinished>,
}

/// What the panel and the strip's hover controls can ask for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum PomodoroCommand {
    /// Starts the given phase from the top, or the current one when `phase` is `None`. A
    /// running timer restarts.
    Start {
        phase: Option<PomodoroPhase>,
    },
    /// Picks a preset while idle without starting it; ignored while running or paused.
    Select {
        phase: PomodoroPhase,
    },
    Pause,
    Resume,
    /// Back to the top of the current phase, idle.
    Reset,
    /// Ends the current phase and moves to the next one.
    Skip,
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait PomodoroSink: Send + Sync {
    fn state_changed(&self, state: &PomodoroState);
}

pub struct PomodoroService {
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    timer: Mutex<PomodoroTimer>,
    settings: Mutex<PomodoroSettings>,
    /// When the activity was last handed to the hub while running.
    published_at: Mutex<Option<Instant>>,
    sink: Mutex<Option<Arc<dyn PomodoroSink>>>,
    /// Wakes the tick loop after a command so a new deadline is honoured at once.
    wake: Notify,
}

impl std::fmt::Debug for PomodoroService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PomodoroService")
            .field("timer", &*self.timer.lock())
            .finish_non_exhaustive()
    }
}

impl PomodoroService {
    #[must_use]
    pub fn new(hub: Arc<Hub>, store: Arc<Store>, clock: Arc<dyn Clock>) -> Self {
        let settings = PomodoroSettings::default();
        Self {
            hub,
            store,
            clock,
            timer: Mutex::new(PomodoroTimer::new(&settings)),
            settings: Mutex::new(settings),
            published_at: Mutex::new(None),
            sink: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn PomodoroSink>) {
        *self.sink.lock() = Some(sink);
    }

    fn now(&self) -> Now {
        Now {
            mono: self.clock.now(),
            wall: self.clock.system_time(),
        }
    }

    #[must_use]
    pub fn settings(&self) -> PomodoroSettings {
        self.settings.lock().clone()
    }

    #[must_use]
    pub fn state(&self) -> PomodoroState {
        let now = self.now();
        let timer = self.timer.lock();
        let settings = self.settings.lock();
        self.state_of(&timer, &settings, now)
    }

    fn state_of(
        &self,
        timer: &PomodoroTimer,
        settings: &PomodoroSettings,
        now: Now,
    ) -> PomodoroState {
        let sessions_today = self
            .store
            .pomodoro_sessions_today(unix_ms(now.wall))
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "pomodoro session log unavailable");
                0
            });
        PomodoroState {
            phase: timer.phase(),
            status: timer.status(),
            remaining_ms: clamp_ms(timer.remaining(now)),
            total_ms: clamp_ms(timer.total()),
            completed_in_cycle: timer.completed_in_cycle(),
            cycle_length: settings.long_break_every,
            sessions_today,
            last_finished: timer.last_finished(),
        }
    }

    /// Runs one command and returns the state after it.
    pub fn command(&self, command: PomodoroCommand) -> PomodoroState {
        let now = self.now();
        let (state, aborted) = {
            let mut timer = self.timer.lock();
            let settings = self.settings.lock();
            let aborted = match command {
                PomodoroCommand::Start { phase } => {
                    if let Some(phase) = phase {
                        timer.select_phase(phase, &settings);
                    }
                    timer.start(now)
                }
                PomodoroCommand::Select { phase } => {
                    timer.select_phase(phase, &settings);
                    None
                }
                PomodoroCommand::Pause => {
                    timer.pause(now);
                    None
                }
                PomodoroCommand::Resume => {
                    timer.resume(now);
                    None
                }
                PomodoroCommand::Reset => timer.reset(now),
                PomodoroCommand::Skip => timer.skip(now, &settings),
            };
            if let Some(run) = aborted {
                self.log(&run);
            }
            (self.state_of(&timer, &settings, now), aborted)
        };
        tracing::debug!(?command, aborted = aborted.is_some(), "pomodoro command");
        self.publish(&state, now);
        state
    }

    /// Checks the deadline; called by the backend every [`TICK`] while running and after every
    /// command. Returns the run that just finished, if one did.
    pub fn tick(&self) -> Option<Run> {
        let now = self.now();
        let (finished, state, republish) = {
            let mut timer = self.timer.lock();
            let settings = self.settings.lock();
            let finished = timer.tick(now, &settings);
            if let Some(run) = finished {
                self.log(&run);
                if settings.auto_start_next {
                    timer.auto_start(now);
                }
            }
            let due = self
                .published_at
                .lock()
                .is_none_or(|at| now.mono.saturating_duration_since(at) >= REPUBLISH);
            (finished, self.state_of(&timer, &settings, now), due)
        };
        if let Some(run) = finished {
            tracing::info!(
                phase = ?run.phase,
                while_asleep = run.while_asleep,
                "pomodoro phase finished"
            );
            self.hub.publish_notice(finished_notice(run.phase));
            self.publish(&state, now);
        } else if republish && state.status == PomodoroStatus::Running {
            self.publish(&state, now);
        }
        finished
    }

    /// How long the tick loop may sleep: until the deadline or the next check while running,
    /// forever (until a command wakes it) otherwise.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let now = self.now();
        let timer = self.timer.lock();
        match timer.status() {
            PomodoroStatus::Running => Some(timer.remaining(now).min(TICK)),
            PomodoroStatus::Idle | PomodoroStatus::Paused => None,
        }
    }

    /// Applies `settings.modules.pomodoro` (start-up and every settings change). An idle
    /// timer takes the new length at once; a running one finishes with the old one.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = PomodoroSettings::from_document(settings);
        let now = self.now();
        let state = {
            let mut timer = self.timer.lock();
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
            timer.apply_settings(&current);
            self.state_of(&timer, &current, now)
        };
        self.publish(&state, now);
    }

    fn log(&self, run: &Run) {
        let record = PomodoroSessionRecord {
            phase: phase_name(run.phase).into(),
            started_at_ms: unix_ms(run.started_wall),
            ended_at_ms: unix_ms(run.ended_wall),
            completed: run.completed,
        };
        if let Err(error) = self.store.log_pomodoro_session(&record) {
            tracing::warn!(%error, "pomodoro session could not be logged");
        }
    }

    /// Hands the strip its activity (or takes it back), tells the sink and wakes the loop.
    fn publish(&self, state: &PomodoroState, now: Now) {
        match state.status {
            PomodoroStatus::Idle => {
                self.hub.retract_activity(ACTIVITY_ID);
                *self.published_at.lock() = None;
            }
            PomodoroStatus::Running | PomodoroStatus::Paused => {
                self.hub.publish_activity(activity(
                    state.phase,
                    state.remaining_ms,
                    state.total_ms,
                    state.status == PomodoroStatus::Running,
                ));
                *self.published_at.lock() = Some(now.mono);
            }
        }
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.state_changed(state);
        }
        self.wake.notify_one();
    }
}

/// The strip activity for a phase with `remaining_ms` left; the UI counts down from here.
#[must_use]
pub fn activity(phase: PomodoroPhase, remaining_ms: u32, total_ms: u32, running: bool) -> Activity {
    Activity {
        id: ACTIVITY_ID.into(),
        module: ID.into(),
        priority: priority::POMODORO,
        leading: Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(phase_tint(phase)),
        }),
        trailing: Some(Trailing::Timer {
            remaining_ms,
            total_ms,
            running,
        }),
        wide: Some(StripMessage::Pomodoro { phase }),
    }
}

/// The notice for a phase that ran out; holds the strip for the default 4 s.
#[must_use]
pub fn finished_notice(phase: PomodoroPhase) -> Notice {
    Notice {
        id: FINISHED_NOTICE_ID.into(),
        module: ID.into(),
        priority: priority::POMODORO,
        leading: Some(Leading::Icon {
            glyph: Glyph::Timer,
            tint: Some(Tint::Green),
        }),
        trailing: None,
        wide: Some(StripMessage::PomodoroFinished { phase }),
        hold_ms: 0,
    }
}

/// Work is warm, breaks are green (docs/modules/pomodoro.md, "warm accent").
#[must_use]
pub const fn phase_tint(phase: PomodoroPhase) -> Tint {
    match phase {
        PomodoroPhase::Work => Tint::Orange,
        PomodoroPhase::ShortBreak | PomodoroPhase::LongBreak => Tint::Green,
    }
}

/// The phase's serialised name, as the session log stores it.
#[must_use]
pub const fn phase_name(phase: PomodoroPhase) -> &'static str {
    match phase {
        PomodoroPhase::Work => "work",
        PomodoroPhase::ShortBreak => "shortBreak",
        PomodoroPhase::LongBreak => "longBreak",
    }
}

fn clamp_ms(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).unwrap_or(u32::MAX)
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: runs the tick loop that fires deadlines and republishes the countdown.
#[derive(Debug, Clone)]
pub struct PomodoroModule(pub Arc<PomodoroService>);

impl ModuleBackend for PomodoroModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
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
                service.tick();
            }
        });
        Ok(())
    }
}
