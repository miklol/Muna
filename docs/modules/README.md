# Module specs

One file per module. Every spec follows the same skeleton so agents can implement modules
independently against the **module contract** defined in
[`../03-architecture.md`](../03-architecture.md#module-contract).

| Tier | Module | Spec |
|------|--------|------|
| P0 | Notch shell (strip, panel, module bar, placement, capture-hiding) | [notch-shell.md](notch-shell.md) |
| P0 | Live Activities & notices | [live-activities.md](live-activities.md) |
| P0 | Media | [media.md](media.md) |
| P0 | Volume / brightness HUD | [hud.md](hud.md) |
| P0 | Settings window | [settings.md](settings.md) |
| P1 | Dashboard | [dashboard.md](dashboard.md) |
| P1 | Calendar | [calendar.md](calendar.md) |
| P1 | Todo | [todo.md](todo.md) |
| P1 | Pomodoro | [pomodoro.md](pomodoro.md) |
| P1 | Weather | [weather.md](weather.md) |
| P1 | Notifications | [notifications.md](notifications.md) |
| P1 | Bluetooth | [bluetooth.md](bluetooth.md) |
| P1 | System Monitor | [system-monitor.md](system-monitor.md) |
| P1 | Drop Actions | [drop-actions.md](drop-actions.md) |
| P1 | Shelf | [shelf.md](shelf.md) |
| P1 | Window snap | [window-snap.md](window-snap.md) |
| P1 | Code hosting | [code-hosting.md](code-hosting.md) |
| P1 | Keyboard shortcuts | [keyboard-shortcuts.md](keyboard-shortcuts.md) |
| P2 | Notes | [notes.md](notes.md) |
| P2 | Day Progress | [day-progress.md](day-progress.md) |
| P2 | Screen Time | [screen-time.md](screen-time.md) |
| P2 | Health | [health.md](health.md) |
| P2 | AI Coding | [ai-coding.md](ai-coding.md) |
| P2 | Translation | [translation.md](translation.md) |
| P2 | Mirror | [mirror.md](mirror.md) |
| P2 | Support & diagnostics | [support.md](support.md) |

## Spec skeleton

```markdown
# <Module>
Tier · Owner agent · Status
## Purpose
## Reference (MacNotch screenshots & behaviour)
## States
  collapsed live activity · hover-reveal · expanded panel · dashboard widget · empty/error
## Data & platform
  sources, Windows APIs, permissions, polling/event strategy, offline behaviour
## Settings
## Accessibility & i18n
## Acceptance criteria (Given/When/Then)
## Perf budget
## Open questions
```
