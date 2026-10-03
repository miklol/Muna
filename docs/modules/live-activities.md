# Live Activities & notices

**Tier P0 · Owner: `muna-module-developer` (runtime) + `muna-ui-engineer` · Status: in progress
(M1-E2: scheduler, power/session/Bluetooth sources, strip renderers and the Windows Bluetooth
watcher landed; the expanded view follows)**

## Purpose

The runtime concept that decides **what the collapsed strip shows**. Modules publish
*activities* (long-lived, e.g. "playing", "timer running", "event in 10 min") and *notices*
(short, e.g. "Charging 57 %", "AirPods connected", volume HUD). The Live Activities module
renders the queue in the strip and lists activities in its expanded view with Focus/Unfocus.

## Reference

`demo-01`, `demo-26`, `live-feature-2/3/4`. Activity cards: art/icon, name, accent primary line,
secondary line, Focus/Unfocus pill; inactive cards dimmed.

## Model

The contract is a closed vocabulary (`muna-core::activities`, exported to
`@muna/contracts` by tauri-specta). Slots carry *facts*, never text the UI cannot localise;
the shell maps each fact to a renderer and builds the screen-reader description from them.

```ts
type Glyph = 'battery' | 'batteryCharging' | 'bluetooth' | 'headphones' | 'lock' | 'unlock'
  | 'timer' | 'bell' | 'music' | 'moon';
type Leading =
  | { kind: 'icon'; glyph: Glyph; tint: Tint | null }
  | { kind: 'battery'; percent: number; charging: boolean }
  | { kind: 'image'; src: string };
type Trailing =
  | { kind: 'icon'; glyph: Glyph; tint: Tint | null }
  | { kind: 'text'; value: string }
  | { kind: 'percent'; value: number }
  | { kind: 'battery'; percent: number; charging: boolean }
  | { kind: 'timer'; remainingMs: number; totalMs: number; running: boolean }
  | { kind: 'progress'; percent: number };
type StripMessage =                       // the wide form's one line, localised by the UI
  | { kind: 'text'; value: string }
  | { kind: 'batteryLow'; percent: number }
  | { kind: 'bluetoothConnected'; name: string; batteryPercent: number | null }
  | { kind: 'bluetoothDisconnected'; name: string }
  | { kind: 'timerFinished'; label: string };
type Activity = {
  id: string;                 // `${moduleId}:${key}`
  module: string;
  priority: number;           // 0..100, module default + user boost
  leading: Leading | null;
  trailing: Trailing | null;
  wide: StripMessage | null;  // a change shows the wide form for 2.5 s
};
type Notice = Activity & { holdMs: number };   // 0 = default hold
type StripContent =
  | { kind: 'idle' }
  | { kind: 'activity'; activity: Activity; wide: boolean }
  | { kind: 'notice'; notice: Notice };
```

Countdowns are anchored client-side to the moment the content arrived, so a timer republished
once a minute still reads to the second and the backend never ticks.

Scheduler (`muna-core::activities::Scheduler`, driven through `Hub`):

1. Notices pre-empt for `holdMs` (default 4 000 ms — `NOTICE_HOLD`; HUD 1 500 ms after the last
   input, per the [motion spec](../06-motion-spec.md#timings-non-spring)). A second notice
   queues behind the first; the same id republished refreshes the hold.
2. Otherwise show the **focused** activity if any, else the highest priority; rotate among
   ties every 8 s (`TIE_ROTATION`) with a crossfade + width morph.
3. A change to an activity's `wide` text → *wide* form for 2 500 ms (`WIDE_FORM_HOLD`) then
   settle (MacNotch's "brief wider layout").
4. No activities → strip shows the idle content (clock optional, or nothing but the black
   shape).
5. The strip is **suspended** per window while its panel covers it (`set_strip_suspended`):
   notices queue and are released 150 ms after the collapse settles; activities keep updating
   silently.

Default priorities (`muna-core::activities::priority`): HUD 100 · charging/battery 90 ·
Bluetooth connect 85 · Pomodoro 70 · Event starting ≤ 10 min 65 · Media playing 60 · Task due
≤ 60 min 55 · Unread notifications 40 · Session lock 30 · Media paused 20 · CPU gauge 10.

## Built-in notices (Windows sources)

| Notice | Source | Visual |
| -------- | -------- | -------- |
| Charging / unplugged / battery low (20 %, 10 %) | `WM_POWERBROADCAST` → `Platform::power()` | battery glyph fills green; % in trailing slot; amber/red at low |
| Bluetooth connected / disconnected (+ battery) | Bluetooth module events | device glyph + name; battery pill |
| Volume / brightness / mute / mic mute | HUD module | slider fills trailing slot |
| Session locked / unlocked | `WTSRegisterSessionNotification` | lock glyph |
| Focus Assist changed | notifications module | moon glyph |
| Screen recording / camera in use | privacy indicators (`Windows.Media.Capture` usage via registry `CapabilityAccessManager\ConsentStore`) | dot indicator, like macOS |
| Pomodoro finished | Pomodoro module | bell + optional Timer Done overlay |
| Task due | To-do module | check-circle glyph + task title; the due time in the trailing slot |

### Implementation notes (M1-E2)

- Sources live in the app crate (`src-tauri/src/modules/live_activities/{power,session,bluetooth}.rs`)
  as pure reducers over `PlatformEvent`s, so they test against `FakePlatform` without Tauri.
  Ids: `power:charging`, `power:unplugged`, `power:low:20`, `power:low:10`, `session:locked`,
  `session:unlocked`, `bluetooth:<device id>`.
- **Power** notices are compact: a battery glyph in the leading slot and the percentage in the
  trailing slot, no text. Low battery is the exception — it also carries `batteryLow` so the
  wide form reads "Low battery" (colour alone must not carry the warning, WCAG 1.4.1). The first
  reading after start and readings without a percentage are silent. Thresholds fire once per
  crossing while discharging.
- **Session** notices are glyph-only (`lock`/`unlock`, untinted); assistive technology hears
  "Locked" / "Unlocked" from the glyph label.
- **Bluetooth** notices use the `headphones` glyph when the name suggests earbuds or a headset
  and `bluetooth` otherwise, tinted blue; the trailing slot shows the device battery when known.
  Disconnects are reported only for devices seen connected. On Windows the devices come from
  `muna-platform`'s paired-device watcher ([bluetooth → Implementation notes](bluetooth.md#implementation-notes-m1-e2)),
  which publishes nothing until its first enumeration completes, so devices already connected at
  start-up seed the reducer instead of announcing themselves.
- The Pomodoro path (`pomodoro:timer`, Timer glyph + countdown, wide text "Focus" / "Short
  break" / "Long break") is published by the Pomodoro module since M3-E3
  ([pomodoro → Implementation notes](pomodoro.md#implementation-notes-m3-e3)); it replaced the
  M1 demo source behind `MUNA_DEMO=pomodoro`. Finishing a phase raises the `pomodoro:finished`
  notice.
- The To-do module publishes `todo:due` (check-circle glyph, the task title, the due time in
  the trailing slot) for the earliest open timed task due within the next 60 minutes, keeping it
  up to 15 minutes past the due time, and raises a `todo:due:<task id>` notice at the due time
  ([todo → Implementation notes](todo.md#implementation-notes-m3-e2)). All-day tasks never
  reach the strip.

## Settings (pane: Live Activities)

Per-source enable; per-source priority boost; rotation interval; wide-on-track-change; notices
duration; sounds; show unread glance; external displays mirror the primary or run their own queue.

## Acceptance criteria

- Given media playing and a 25-min Pomodoro running, then the strip shows Pomodoro (70 > 60)
  unless the user Focuses Media.
- Given a volume key press while a Pomodoro is shown, then the HUD appears within 16 ms and the
  Pomodoro returns 1 500 ms after the last key.
- Given a track change, then the wide form appears for 2.5 s with title marquee only if the
  title overflows.
- Given all sources disabled, then the strip renders only the black shape (no empty text).
- Given the panel is open when a notice arrives, then the notice shows after the panel collapses
  (S8 in [testing](../09-testing-qa.md#notch-shell-scenario-suite-harness-page)).

## Perf budget

Scheduler tick is event-driven (no polling): the hub sleeps until its next deadline and is woken
by publishes. Visualiser runs only while media is playing and the strip is visible; countdowns
tick only while the strip is mounted.
