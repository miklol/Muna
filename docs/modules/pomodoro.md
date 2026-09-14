# Pomodoro

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

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
- Ring animation is driven by `requestAnimationFrame` only while visible.
