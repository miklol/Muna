//! The pomodoro state machine (docs/modules/pomodoro.md): phases, running/paused/idle, the
//! cycle position, and the two-clock deadline that keeps a running timer honest across sleep.
//!
//! Pure and synchronous: every method takes the time as an argument, so the tests in
//! `tests/pomodoro.rs` drive it with a `FakeClock` and the service only adds the tick loop.
//! The monotonic reading gives drift-free countdowns while the machine is awake; the wall-clock
//! reading catches the cases the monotonic clock cannot — a sleep that paused it, or a tick
//! that fired long after the deadline because the process was suspended.

use std::time::{Duration, Instant, SystemTime};

use muna_core::PomodoroPhase;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::settings::PomodoroSettings;

/// A monotonic and a wall-clock reading taken together.
#[derive(Debug, Clone, Copy)]
pub struct Now {
    pub mono: Instant,
    pub wall: SystemTime,
}

/// How far the two clocks may disagree about the time left before the wall clock is trusted
/// (the monotonic clock paused during sleep, or the clock was set).
pub const SLEEP_TOLERANCE: Duration = Duration::from_secs(2);

/// A completion noticed this long after its deadline counts as "finished while asleep" even
/// when both clocks agree: nobody was there to see the last seconds.
pub const LATE_TOLERANCE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum PomodoroStatus {
    /// Nothing running; the ring is full and the button says start.
    Idle,
    Running,
    Paused,
}

/// A phase that ran out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PomodoroFinished {
    pub phase: PomodoroPhase,
    /// The deadline passed while the machine slept or the process was suspended.
    pub while_asleep: bool,
}

/// A run that ended, complete or not, for the session log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Run {
    pub phase: PomodoroPhase,
    pub started_wall: SystemTime,
    pub ended_wall: SystemTime,
    pub completed: bool,
    pub while_asleep: bool,
}

#[derive(Debug, Clone, Copy)]
enum Progress {
    Idle,
    Running {
        started_wall: SystemTime,
        deadline_mono: Instant,
        deadline_wall: SystemTime,
    },
    Paused {
        started_wall: SystemTime,
        remaining: Duration,
    },
}

#[derive(Debug, Clone)]
pub struct PomodoroTimer {
    phase: PomodoroPhase,
    total: Duration,
    progress: Progress,
    /// Work phases completed since the last long break.
    completed_in_cycle: u8,
    last_finished: Option<PomodoroFinished>,
}

impl PomodoroTimer {
    /// Idle at the start of a work phase.
    #[must_use]
    pub fn new(settings: &PomodoroSettings) -> Self {
        Self {
            phase: PomodoroPhase::Work,
            total: settings.duration(PomodoroPhase::Work),
            progress: Progress::Idle,
            completed_in_cycle: 0,
            last_finished: None,
        }
    }

    #[must_use]
    pub const fn phase(&self) -> PomodoroPhase {
        self.phase
    }

    #[must_use]
    pub const fn total(&self) -> Duration {
        self.total
    }

    #[must_use]
    pub const fn status(&self) -> PomodoroStatus {
        match self.progress {
            Progress::Idle => PomodoroStatus::Idle,
            Progress::Running { .. } => PomodoroStatus::Running,
            Progress::Paused { .. } => PomodoroStatus::Paused,
        }
    }

    #[must_use]
    pub const fn completed_in_cycle(&self) -> u8 {
        self.completed_in_cycle
    }

    #[must_use]
    pub const fn last_finished(&self) -> Option<PomodoroFinished> {
        self.last_finished
    }

    /// Time left: the whole phase while idle, the frozen value while paused, and the smaller
    /// of the two clocks' opinions while running unless they disagree by more than
    /// [`SLEEP_TOLERANCE`], in which case the wall clock is right.
    #[must_use]
    pub fn remaining(&self, now: Now) -> Duration {
        match self.progress {
            Progress::Idle => self.total,
            Progress::Paused { remaining, .. } => remaining,
            Progress::Running {
                deadline_mono,
                deadline_wall,
                ..
            } => {
                let mono = deadline_mono.saturating_duration_since(now.mono);
                let wall = deadline_wall
                    .duration_since(now.wall)
                    .unwrap_or(Duration::ZERO);
                if clocks_disagree(mono, wall) {
                    wall
                } else {
                    mono
                }
            }
        }
    }

    /// Starts (or restarts) the current phase from the top. Returns the run it cut short, if
    /// one was in progress, for the log.
    pub fn start(&mut self, now: Now) -> Option<Run> {
        let aborted = self.abort(now);
        self.last_finished = None;
        self.progress = Progress::Running {
            started_wall: now.wall,
            deadline_mono: now.mono + self.total,
            deadline_wall: now.wall + self.total,
        };
        aborted
    }

    /// Starts the phase [`Self::tick`] just entered (*auto-start next*). Unlike [`Self::start`]
    /// it keeps `last_finished`: nobody acknowledged the phase that ran out, so the panel still
    /// says so until the next command.
    pub fn auto_start(&mut self, now: Now) {
        let finished = self.last_finished;
        self.start(now);
        self.last_finished = finished;
    }

    /// Picks another phase while idle (a preset in the panel). Ignored while running or paused
    /// — the UI disables the presets then — and returns whether anything changed.
    pub fn select_phase(&mut self, phase: PomodoroPhase, settings: &PomodoroSettings) -> bool {
        if !matches!(self.progress, Progress::Idle) {
            return false;
        }
        let total = settings.duration(phase);
        if self.phase == phase && self.total == total {
            return false;
        }
        self.phase = phase;
        self.total = total;
        self.last_finished = None;
        true
    }

    /// Freezes the countdown. Returns whether it was running.
    pub fn pause(&mut self, now: Now) -> bool {
        let Progress::Running { started_wall, .. } = self.progress else {
            return false;
        };
        let remaining = self.remaining(now);
        self.progress = Progress::Paused {
            started_wall,
            remaining,
        };
        true
    }

    /// Continues a paused countdown from where it stopped. Returns whether it was paused.
    pub fn resume(&mut self, now: Now) -> bool {
        let Progress::Paused {
            started_wall,
            remaining,
        } = self.progress
        else {
            return false;
        };
        self.progress = Progress::Running {
            started_wall,
            deadline_mono: now.mono + remaining,
            deadline_wall: now.wall + remaining,
        };
        true
    }

    /// Back to the top of the current phase, idle. Returns the run it cut short.
    pub fn reset(&mut self, now: Now) -> Option<Run> {
        let aborted = self.abort(now);
        self.last_finished = None;
        aborted
    }

    /// Ends the current phase now and moves to the next one, idle. A skipped work phase does
    /// not count towards the long break. Returns the run it cut short.
    pub fn skip(&mut self, now: Now, settings: &PomodoroSettings) -> Option<Run> {
        let aborted = self.abort(now);
        self.last_finished = None;
        let next = match self.phase {
            PomodoroPhase::Work => PomodoroPhase::ShortBreak,
            PomodoroPhase::ShortBreak => PomodoroPhase::Work,
            PomodoroPhase::LongBreak => {
                self.completed_in_cycle = 0;
                PomodoroPhase::Work
            }
        };
        self.enter(next, settings);
        aborted
    }

    /// Checks the deadline. When the phase ran out, records it, advances to the next phase
    /// (idle; the caller starts it when *auto-start next* is on) and returns the run.
    pub fn tick(&mut self, now: Now, settings: &PomodoroSettings) -> Option<Run> {
        let Progress::Running {
            started_wall,
            deadline_mono,
            deadline_wall,
        } = self.progress
        else {
            return None;
        };
        let mono = deadline_mono.saturating_duration_since(now.mono);
        let wall = deadline_wall
            .duration_since(now.wall)
            .unwrap_or(Duration::ZERO);
        let slept = clocks_disagree(mono, wall);
        if slept {
            // Trust the wall clock from here on so the countdown does not stall.
            self.progress = Progress::Running {
                started_wall,
                deadline_mono: now.mono + wall,
                deadline_wall,
            };
        }
        let remaining = if slept { wall } else { mono };
        if !remaining.is_zero() {
            return None;
        }
        let overdue = now
            .wall
            .duration_since(deadline_wall)
            .unwrap_or(Duration::ZERO);
        let while_asleep = slept || overdue > LATE_TOLERANCE;
        let finished = self.phase;
        let run = Run {
            phase: finished,
            started_wall,
            ended_wall: deadline_wall,
            completed: true,
            while_asleep,
        };
        let next = match finished {
            PomodoroPhase::Work => {
                self.completed_in_cycle = self.completed_in_cycle.saturating_add(1);
                if self.completed_in_cycle >= settings.long_break_every {
                    PomodoroPhase::LongBreak
                } else {
                    PomodoroPhase::ShortBreak
                }
            }
            PomodoroPhase::ShortBreak => PomodoroPhase::Work,
            PomodoroPhase::LongBreak => {
                self.completed_in_cycle = 0;
                PomodoroPhase::Work
            }
        };
        self.progress = Progress::Idle;
        self.enter(next, settings);
        self.last_finished = Some(PomodoroFinished {
            phase: finished,
            while_asleep,
        });
        Some(run)
    }

    /// New durations from the settings pane: an idle timer takes the new length at once; a
    /// running or paused one keeps the length it started with. Returns whether the idle timer
    /// changed.
    pub fn apply_settings(&mut self, settings: &PomodoroSettings) -> bool {
        if !matches!(self.progress, Progress::Idle) {
            return false;
        }
        let total = settings.duration(self.phase);
        if self.total == total {
            return false;
        }
        self.total = total;
        true
    }

    fn enter(&mut self, phase: PomodoroPhase, settings: &PomodoroSettings) {
        self.phase = phase;
        self.total = settings.duration(phase);
        self.progress = Progress::Idle;
    }

    /// Stops whatever is in progress and reports it as an incomplete run.
    fn abort(&mut self, now: Now) -> Option<Run> {
        let run = match self.progress {
            Progress::Idle => None,
            Progress::Running { started_wall, .. } | Progress::Paused { started_wall, .. } => {
                Some(Run {
                    phase: self.phase,
                    started_wall,
                    ended_wall: now.wall,
                    completed: false,
                    while_asleep: false,
                })
            }
        };
        self.progress = Progress::Idle;
        run
    }
}

fn clocks_disagree(mono: Duration, wall: Duration) -> bool {
    mono.abs_diff(wall) > SLEEP_TOLERANCE
}
