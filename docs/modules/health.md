# Health

**Tier P2 · Owner: `muna-module-developer` · Status: implemented (M5-E1b) — see
[Implementation notes](#implementation-notes-m5-e1b)**

## Reference

`health-feature`, `-2…5`. Today stats (Active, Longest sit, Breaks, Mindful); three rings
(green breaks / blue water / purple mindful) + weekday dots + counters (Water droplets ±);
"Take a break" cards: Move 3 min, Breathe 4-4-4-4, Stretch 2 min, Eye rest 20 s (▶ each).
Header: heart icon, "Sitting for 4m", `29m` chip, layout toggle.

## Behaviour

- Sitting timer from input activity (`GetLastInputInfo`), pauses on lock/idle.
- Break reminders at interval (default 50 min) as a strip notice; snooze.
- Guided flows render **inside the panel** (pinned): Move (timer + prompts), Breathe (animated
  circle with box-breathing 4-4-4-4 or 4-7-8), Stretch (step list with timer), Eye rest (20-20-20
  full-screen overlay `overlay-eyebreak`, skippable).
- Water goal + logging; mindful minutes from Breathe; streaks; wind-down hour dims the notch
  accent; hearing warning when volume > 85 % with headphones for > 10 min (uses HUD data).
- No permissions; all local.

## Acceptance criteria

- Rings animate with a spring on change; weekday dots reflect goals met.
- Eye-break overlay never appears during a detected fullscreen/presentation state.

## Implementation notes (M5-E1b)

Nothing new hooks the desktop: the module reads the idle time, the lock, the volume and the
audio and Bluetooth devices the platform layer already exposes, and keeps **one row per day**
of counters. No timestamps of individual events and nothing about *what* the user was doing
is stored. Pieces, in the order a sit flows:

- **Tracker** (`src-tauri/src/modules/health/tracker.rs`, pure): a *sit* runs from the moment
  input resumes until the user is away — no input for **3 min**, the session locked, the
  machine asleep (two ticks more than 2 min apart), or the module turned off. A short absence
  is skipped and the sit continues; a long one ends the sit and, when the sit was **≥ 10
  min**, counts as a break. The service samples `Foreground::idle_for` every **30 s** while
  the user is at the desk and sleeps until the next deadline otherwise, so an idle app runs
  nothing. A sit crossing midnight keeps its start; its time is credited to the record at
  least every 5 min so a crash loses no more than that.
- **Reminder**: when the sit reaches `breakEveryMin` (default 50, 15–180) the strip shows
  *Time for a break* as a **notice** (`priority::HEALTH`, 44, held 8 s) and the panel leads
  its flows with the reminder card. *Snooze* pushes it out 10 min; *Dismiss* clears it until
  the next interval. While a fullscreen app or a presentation is in front the reminder waits
  5 min at a time — the notch would be parked and the notice unseen.
- **Flows**: Move (3 min), Stretch (2 min), Eye rest (20 s) and Breathe (box 4-4-4-4, eight
  rounds = 2:08, or relax 4-7-8, six rounds = 1:54). A running flow is a **live activity**
  (`priority::HEALTH_FLOW`, 64) counting down in the strip and **pins the panel open**
  through the shell's hold (docs/modules/notch-shell.md); Move and Stretch count as breaks
  and start a fresh sit when they finish, Breathe adds its seconds to *mindful*, and every
  finished flow shows a 4 s *Done* notice. Eye rest runs **inside the panel**, not as a
  full-screen overlay: the panel is already in front and a pinned 112 px ring with the
  instruction is enough (the `overlay-eyebreak` reference stays deferred).
- **Goals, week and streak**: the breaks goal is **derived** from the interval — one break per
  interval over six hours at the desk (50 min → 7), the water goal is a setting (default 8,
  1–20), the mindful goal is fixed at 10 min. The seven weekday dots count goals met per day;
  the streak is the days in a row, counting back from today (or yesterday while today has
  none yet), with at least one goal met. Days are kept for 90 days.
- **Wind-down**: from `windDownHour` (18–23, off by default) until 5 am the snapshot flags
  `windingDown` and the panel shows a chip; the accent dimming the reference shows is
  deferred to the fidelity epic.
- **Hearing**: the hearing clock starts when the volume stays **above 85 %**, unmuted, and
  headphones are in use, and warns once after **10 min** (`healthHearing` notice, orange status
  in the panel). "Headphones" is a heuristic — a connected Bluetooth device classified as
  headphones, or a default render device *named* like one (`Headphones (Realtek Audio)`) —
  because Windows exposes no form factor for a wired headset. Off by setting.
- **Storage** (`muna-core`, migration 6): `health_days (day_start, active_ms, longest_sit_ms,
  breaks, water, mindful_seconds, flows)`.
- **Snapshot and publishing**: `{ enabled, sitting, sittingSinceMs, sittingMs, nextBreakInMs,
  breakDueSinceMs, today, goals, week, streakDays, flow, hearing, windingDown, dayStartMs,
  generatedAtMs }`. `sitting` is `sitting | away | locked | off`; `nextBreakInMs` is `null`
  while a reminder is up or a flow runs. Rust publishes `HealthChanged` **only when the
  discrete state changes** (a sit starts or ends, a flow, a counter, the reminder); the UI
  counts `sittingMs` up and `nextBreakInMs`/`flow.remainingMs` down from the moment the
  snapshot arrived, once a second, only while sitting or a flow runs and a view is mounted.
- **Commands**: `get_health_snapshot` and `health_command({ kind: 'startFlow' | 'stopFlow'
  | 'water' | 'snooze' | 'dismiss' | 'reset' | 'clearHistory' })`, both answering the fresh
  snapshot. Settings `settings.modules.health = { enabled (true), breakEveryMin (50),
  waterGoal (8), windDownHour (null), hearingWarning (true), breathePattern ('box') }`;
  the breathing pattern is a setting the reference did not have. Zod schemas and the bounds
  live in `@muna/contracts`.
- **Panel** (`src/modules/health/panel.tsx`): the head (heart, *Sitting for 34 min*, the
  next-break chip or *Time for a break*, *Winding down*, *Settings*), then three columns —
  **Today** (Active, Longest sit, Breaks, Mindful, the streak, the hearing status), **Goals**
  (three concentric `Ring`s, green breaks / blue water / purple mindful, the weekday dots
  filled by goals met, the counters with water ∓) and **Take a break** (the four flow cards;
  the reminder card with *Snooze*/*Dismiss* leads while a break is due). Starting a flow
  swaps the columns for the **flow view**: a 112 px ring with the countdown and the guidance
  — Move prompts every 30 s, Breathe an animated circle whose scale follows the phase (its
  transition length *is* the phase length, content pacing rather than a motion preset; under
  reduced motion the circle stands still and the phase text carries it), Stretch a step list
  with `aria-current="step"`, Eye rest the instruction — and a *Stop* button in the head.
  *Away*, *Locked* and *Health is off* (with *Open Settings*) say why the timer is paused.
- **Widget** (`widget.tsx`): the three rings small, the sit and the next reminder (or the
  flow, or why the timer is paused) and a *+* that logs a glass of water.
- **Settings pane** (`settings.tsx`): *Track sitting*, *Remind me every* (with the derived
  breaks goal in its description), *Water goal*, *Breathing pattern*, *Wind down in the
  evening* with the hour once on, *Warn me about loud headphones*, *Reset today* and *Clear
  history* with an inline confirmation.
- **Actions**: `health.water` logs a glass; `health.breathe` opens the panel and starts the
  Breathe flow (docs/modules/dashboard.md "Actions").
- **Against the spec**: the flow live activity runs at priority 64 and the notices at 44 (the
  plan said 45) so a running flow shows over playing media but under a starting event or the
  pomodoro, and a break reminder yields to code-hosting notices; the eye rest is in-panel;
  wind-down is a flag and a chip; the breaks goal is derived rather than set; the streak
  counts days with **any** goal met.
