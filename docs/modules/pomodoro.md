# Pomodoro

**Tier P1 · Owner: `muna-module-developer` · Status: implemented (M3-E3; presets, sound, Timer
Done overlay, Focus Assist and Focus Target deferred — see
[Implementation notes](#implementation-notes-m3-e3))**

## Reference

`demo-14`, `demo-20`, `pomodoro-feature-2/3`. Panel: mode card + ring dial (25m) with ↺ and ⏭,
preset list (Work 25 · Short Break 5 · Long Break 15 · Quick Timer 5 · Custom) with drag
handles, **Focus Target** column (attach to an event/task, `Select` pills). Strip: tomato/work
glyph + `27:33` (tabular, warm accent); hover-reveal ↺ ⏸ ⏭ ✕.

## Behaviour

- Cycles: work → short break × N → long break; auto-start next (setting).
- Focus Target links a session to a Calendar event or Todo task; completing marks time on it.
- Completion: sound (optional), notice in strip, optional **Timer Done** full-screen overlay
  (dim + big text + Dismiss/Start break), optional Focus Assist during work sessions.
- Sessions logged locally for "N sessions today" and Screen Time/Health integration.

## Acceptance criteria

- Timer drift ≤ 1 s over 25 min (monotonic clock in Rust; UI only renders).
- Sleep/resume: timer keeps wall-clock correctness and shows "finished while asleep" if so.
- Ring animation runs only while the timer is running and the ring is visible; a hidden or
  stopped timer schedules no animation work (RAF, intervals or timers).

## Implementation notes (M3-E3)

The module replaces the M1 demo source (`MUNA_DEMO=pomodoro`) with a real backend and panel.
Pieces, in the order the data flows:

- **Timer** (`src-tauri/src/modules/pomodoro/timer.rs`): a pure state machine over two clocks.
  The countdown runs on the monotonic clock (drift-free); a wall-clock deadline is kept beside
  it so the phase survives sleep. `remaining()` trusts the wall clock whenever the two disagree
  by more than 2 s (`SLEEP_TOLERANCE`) and `tick()` re-anchors; a phase that ran out more than
  5 s ago (`LATE_TOLERANCE`) or across a sleep is reported with `whileAsleep`. Cycle: work →
  short break, repeated, with a long break after every *N*th work phase; a skipped work phase
  does not count, and a long break (finished or skipped) resets the cycle.
- **Service** (`mod.rs`): one task per app. While a phase runs it wakes every 5 s (`TICK`) to
  detect the deadline and republishes the strip activity once a minute (`REPUBLISH`); idle and
  paused it only waits on a `Notify`, so a stopped timer costs zero timers. Finishing a phase
  publishes a `pomodoro:finished` notice (green Timer glyph, default 4 s hold), logs the
  session to SQLite (`pomodoro_sessions`; "sessions today" is `date(ended_at, 'localtime') =
  today` for completed work phases) and either auto-starts the next phase (setting) or parks
  it, ready to start.
- **Contract**: `get_pomodoro_snapshot`, `pomodoro_command({start | select | pause | resume |
  reset | skip})` and the `PomodoroStateChanged` event; the state carries phase, status,
  `remainingMs`/`totalMs`, `completedInCycle`, `sessionsToday`, the last finished phase and the
  settings in force. `start` while running restarts the current phase; `select` picks a preset
  while idle without starting it.
- **Strip**: `pomodoro:timer` activity (priority `POMODORO`, Timer glyph tinted orange for work
  and green for breaks, `Trailing::Timer` countdown that the UI runs locally at 1 Hz only while
  running and mounted; wide form "Focus" / "Short break" / "Long break").
- **Panel**: 144 px ring dial with the countdown (display size, `title1` at ≥ 1 h), phase label,
  cycle dots, "N sessions today", primary Start/Pause/Resume, Reset and Skip, and a Focus /
  Short break / Long break preset selector (`SegmentedControl`, disabled while running). The ring
  updates at 1 Hz from `useCountdown`, which stops when the timer is paused/idle or the panel
  unmounts. The panel height follows its content between 190 and 360 px.
- **Settings** (`settings.modules.pomodoro`, zod mirror in `@muna/contracts`): focus 5–90 min
  (default 25), short break 1–30 (5), long break 5–60 (15), long break after 2–8 phases (4),
  auto-start next (off). An idle timer resizes at once; a running or paused phase keeps its
  length; the cycle length applies live. Out-of-range values clamp, wrong types fall back to the
  defaults for the whole entry (like serde).
- **Tests**: `tests/pomodoro.rs` (23; `FakeClock` + in-memory `Store`) covers the cycle, pause
  and resume, drift, sleep/resume (`whileAsleep`), the once-a-minute republish, settings
  changes, the session log and the notice; Vitest covers the store, the panel and the settings
  pane; `strip-content` tests cover the new strip messages.

Deviations from the spec above, decided in M3-E3:

- **The ring steps at 1 Hz instead of a `requestAnimationFrame` loop.** The countdown only
  changes once a second, so `useCountdown` ticks on a 1 s interval while running and mounted and
  the `Ring` primitive springs between the steps; a continuous RAF loop would cost frames for no
  visible change. The acceptance criterion above was reworded to the intent (no animation work
  while hidden or stopped).
- **Presets are the three phases only.** Quick Timer, Custom and drag-to-reorder presets are
  deferred; the reference list is a P2 polish item once a custom-length timer has a use case.
- **No sound, Timer Done overlay or Focus Assist yet.** Completion is the strip notice; the
  overlay and Focus Assist wait for the notifications module (M3-E5) so they share one
  do-not-disturb model. Sound waits for a shared audio-cue primitive.
- **Focus Target** needs Calendar (M3-E1) and To-do (M3-E2); the panel leaves room for the
  column.
- **Hover-reveal strip controls** (↺ ⏸ ⏭ ✕) are a shell feature not yet built for any module;
  the strip shows the countdown only and the panel carries the controls.
- **"Never auto-restart the app while a session runs"** is an updater rule; it is recorded
  here and lands with the update flow.
