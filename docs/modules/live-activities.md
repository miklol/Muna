# Live Activities & notices

**Tier P0 · Owner: `muna-module-developer` (runtime) + `muna-ui-engineer` · Status: spec**

## Purpose

The runtime concept that decides **what the collapsed strip shows**. Modules publish
*activities* (long-lived, e.g. "playing", "timer running", "event in 10 min") and *notices*
(short, e.g. "Charging 57 %", "AirPods connected", volume HUD). The Live Activities module
renders the queue in the strip and lists activities in its expanded view with Focus/Unfocus.

## Reference

`demo-01`, `demo-26`, `live-feature-2/3/4`. Activity cards: art/icon, name, accent primary line,
secondary line, Focus/Unfocus pill; inactive cards dimmed.

## Model

```ts
type Activity = {
  id: string;                 // `${moduleId}:${key}`
  moduleId: ModuleId;
  priority: number;           // 0..100, module default + user boost
  leading: { kind: 'icon' | 'image' | 'lottie'; src: string; tint?: Accent };
  trailing: { kind: 'visualizer' | 'timer' | 'text' | 'battery' | 'progress'; value: unknown };
  wide?: { title: string; subtitle?: string; actions?: Action[] };   // hover-reveal form
  focused?: boolean;          // user pinned via Focus
  startedAt: number; updatedAt: number; expiresAt?: number;
};
type Notice = Activity & { durationMs: number; sound?: SoundId; interrupt: boolean };
```

Scheduler:
1. Notices pre-empt for `durationMs` (default 3 000 ms; HUD 1 200 ms after last input).
2. Otherwise show the **focused** activity if any, else the highest priority; rotate among
   ties every 8 s with a crossfade + width morph.
3. Track change → *wide* form for 2 500 ms then settle (MacNotch's "brief wider layout").
4. No activities → strip shows the idle content (clock optional, or nothing but the black
   shape).

Default priorities: HUD 100 · charging/battery 90 · Bluetooth connect 85 · Pomodoro 70 ·
Event starting ≤ 10 min 65 · Media playing 60 · Unread notifications 40 · Session lock 30 ·
Media paused 20.

## Built-in notices (Windows sources)

| Notice | Source | Visual |
|--------|--------|--------|
| Charging / unplugged / battery low (20 %, 10 %) | `Windows.System.Power.PowerManager` events | battery glyph fills green; % in trailing slot; amber/red at low |
| Bluetooth connected / disconnected (+ battery) | Bluetooth module events | device glyph + name; battery pill |
| Volume / brightness / mute / mic mute | HUD module | slider fills trailing slot |
| Session locked / unlocked | `WTSRegisterSessionNotification` | lock glyph |
| Focus Assist changed | notifications module | moon glyph |
| Screen recording / camera in use | privacy indicators (`Windows.Media.Capture` usage via registry `CapabilityAccessManager\ConsentStore`) | dot indicator, like macOS |
| Pomodoro finished | Pomodoro module | bell + optional Timer Done overlay |

## Settings (pane: Live Activities)

Per-source enable; per-source priority boost; rotation interval; wide-on-track-change; notices
duration; sounds; show unread glance; external displays mirror the primary or run their own queue.

## Acceptance criteria

- Given media playing and a 25-min Pomodoro running, then the strip shows Pomodoro (70 > 60)
  unless the user Focuses Media.
- Given a volume key press while a Pomodoro is shown, then the HUD appears within 16 ms and the
  Pomodoro returns 1 200 ms after the last key.
- Given a track change, then the wide form appears for 2.5 s with title marquee only if the
  title overflows.
- Given all sources disabled, then the strip renders only the black shape (no empty text).

## Perf budget

Scheduler tick is event-driven (no polling). Visualiser runs only while media is playing and
the strip is visible.
