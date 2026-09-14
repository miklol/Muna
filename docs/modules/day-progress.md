# Day Progress

**Tier P2 · Owner: `muna-module-developer` · Status: spec**

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
