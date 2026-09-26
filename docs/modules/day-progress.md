# Day Progress

**Tier P2 · Owner: `muna-module-developer` · Status: implemented (M3-E6)**

## Reference

`day-progress-feature`, `-2`. Left stats (Today, Completion N/M + bar, per-source counts,
Bedtime); right vertical timeline with time labels, pill node icons, dotted connectors,
"Long stretch — 3h 5m of potential!" hint + `+ Add Task`. Strip: "Next in 10m". Dashboard card
"Starts in 3h 24m" + quote.

## Data

Merges Calendar events, Todo tasks with due times, Pomodoro sessions, optional bedtime (from
Health wind-down). Sources chosen in Settings. Gap detection ≥ 90 min → suggestion row.

## Acceptance criteria

- Timeline updates within 1 s of an event/task change; "now" marker animates smoothly.
- Completion counts only items with times today.

### Implementation notes (M3-E6)

The module is `src-tauri/src/modules/day_progress` + `src/modules/day-progress`. It is the
"pure UI" module of M3: nothing here touches the OS, and the two halves share only the settings
namespace.

- **Sources.** The timeline merges the to-do and pomodoro snapshots in the UI, through the
  contract (`get_todo_snapshot` / `TodoChanged`, `get_pomodoro_snapshot` /
  `PomodoroStateChanged`) — modules never import each other (ADR-0004). A task counts when it
  has a due *time* today (not all-day, not deleted); the running or paused work phase becomes a
  focus block from its elapsed start to its end, and `sessionsToday` is the count. Both sources
  can be turned off in Settings → Day. Calendar events and the Health wind-down are not wired:
  neither module exists yet, so bedtime is a time the user sets here instead.
- **Timeline** (`timeline.ts`, pure and fully unit-tested): items in time order, a now row that
  moves between them on the `layout` spring at every whole minute (one aligned `setTimeout`,
  cleared on unmount — nothing ticks once the panel closes), and the first free stretch of at
  least 90 minutes between `max(now, workStart)` and `workEnd` that no open item occupies (done
  tasks free their slot; bedtime is outside the working day). The stretch row offers *Add a
  task*, which switches the panel to the to-do module and is hidden when that module is off.
  Completion counts only timed tasks today, per the acceptance criterion.
- **Rust half.** Owns `settings.modules.day-progress` (`workStartMinutes` 540,
  `workEndMinutes` 1080, `bedtimeMinutes` null, `showDayInStrip` false, `showTasks` true,
  `showFocusSessions` true; minutes since local midnight) and the strip bar
  `day-progress:bar`: `Glyph::Hourglass` + `Trailing::Progress` at priority 5 (under the CPU
  gauge), published only during working hours and only when `showDayInStrip` is on. The service
  computes the whole percent of the working day gone and sleeps exactly until it changes (capped
  at 60 s so a resumed machine catches up), reading the local UTC offset through a small `Zone`
  trait at every wake (chrono `Local`; `FixedZone` in tests) so a DST change moves the bar with
  the clock. A backwards window is repaired identically on both sides: the end becomes
  start + 15 min, or both fall back to the defaults.
- **Deviations from the spec.** The strip form is the day bar rather than "Next in 10m" —
  `todo:due` already covers the next due task. The dashboard card ("Starts in 3h 24m" + quote)
  belongs to the dashboard module (E9). The hint reads *Long stretch — 2 h 10 min free* rather
  than "of potential!" (no exclamation marks in copy).
