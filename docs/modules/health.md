# Health

**Tier P2 · Owner: `muna-module-developer` · Status: spec**

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
