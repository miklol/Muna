# M1 · Shell & live activities

Read `docs/07-roadmap.md#m1--shell--live-activities-3-weeks` for exit criteria. Requires M0
merged.

---

## M1-E1 · Notch shell — agent: `muna-shell-engineer`

```text
Implement the notch shell per docs/modules/notch-shell.md (all sections), ADR-0002 and the
M0 spike findings in docs/spikes/m0-window.md. Read docs/06-motion-spec.md for the morph
choreography.

Scope:
- Rust `platform::window`: per-monitor NotchWindow lifecycle (create/park/place/destroy),
  monitor topology with stable ids, Overlay and Reserved-strip (SHAppBarMessage) modes,
  Notch/Island shapes (shape rects), yield rules: caption overlap
  (DWMWA_EXTENDED_FRAME_BOUNDS of foreground), fullscreen (poll), move/size (WinEvent hook),
  lock (WTS). Emits `shell.*` events via specta.
- TS `shell/machine.ts`: XState-style state machine Collapsed → Peek / HoverReveal → Expanded →
  Pinned with the timings and velocity gate from the spec; `shapeRects` publisher on layout.
- Components: Strip (2 slots, wide form), Panel container, hit-test debug overlay (dev only).
- Tray icon with menu (Open settings, Pause on this display, Quit); single instance; autostart
  via platform::autostart.
- Tests: the S1–S14 scenario suite from docs/09-testing-qa.md against the harness page;
  cargo tests for yield-rule decisions with FakePlatform.

Evidence: recording of hover→expand→collapse on a 150 % display with fps overlay; perf numbers.
Update the spec status and roadmap table.
```

**Progress.** PR 1 (`feat(shell): notch window manager, yield rules and shell settings`) landed
the Rust half: `ShellModel` + `ShellManager`, `yield_rules`, per-monitor `ShellSettings`
(settings v2), `AppBar`/`Autostart` platform services, tray, hotkey → `ShellToggleRequested`,
the `ShellLayoutChanged` / `ShellYieldChanged` contract and a minimal `NotchWindow` that reports
ready, publishes its strip rect and follows layout/yield. Decisions are recorded in
[notch-shell.md → Implementation notes](../modules/notch-shell.md#implementation-notes-m1-e1).
PR 2 (`feat(shell): notch state machine, strip and panel (m1-e1)`) landed the UI half:
`shell/machine.ts` (pure reducer + timer runner), Strip (two slots, wide form), Panel container
with the empty state, the hit-test overlay, the morph sampler and `report_morph`, the
strip-rest-first rect contract, the peek hit-rect translation in Rust, the `-HitTest` /
`-FullMotion` dev switches and the S1–S7 / S11–S14 scenarios (S8–S10 arrive with their
modules). Measured on a 2560 × 1600 150 % display: expand 158–167 fps, collapse 157–167 fps,
0 dropped frames — numbers and the OS reduced-motion finding are in the implementation notes.
Remaining for the M1 exit criterion: a recording on a 4K 150 % display.

## M1-E2 · Live activities — agent: `muna-module-developer`

```text
Implement docs/modules/live-activities.md and the first sources. Read docs/adr/0004-module-
contract.md and docs/04-windows-platform-apis.md (Devices & power, Shell & window management).

Scope:
- `muna-core::activities`: Activity/Notice model, priority scheduler (values in the spec),
  wide-form timing (2.5 s), tie rotation (8 s), queueing while Expanded, Clock trait.
- Sources: battery/charging (PowerManager events), lock/unlock (WTS), Bluetooth connect/
  disconnect with device name + battery when available (DeviceWatcher), Pomodoro placeholder
  source (fake timer) to prove the API.
- UI: strip renderers for each source using the design system; notice component with
  enter/exit choreography from docs/06-motion-spec.md.
- Tests: scheduler unit tests with fake clock (priority, rotation, queue, wide-form), source
  tests with FakePlatform, Storybook stories for every strip form.

Evidence: laptop recording of plug/unplug and headset connect. Update spec statuses.
```

**Progress.** PR 1 landed the runtime and the strip: `muna-core::activities` (closed slot
vocabulary, `Scheduler`, `Hub` with per-window suspend and an event-driven deadline task), the
module contract (`Surface`, `ModuleCtx`, `ModuleBackend::start`), the live-activities backend
with the power, session and Bluetooth reducers, the Pomodoro demo (`MUNA_DEMO=pomodoro`,
replaced by the real module in M3-E3), the
`@muna/ui` `StripView` / `BatteryGlyph` / `TimerText` primitives with stories, the shell mapping
with localised screen-reader descriptions, and S8. PR 2 landed the Windows `Bluetooth`
implementation: two paired-endpoint `DeviceWatcher`s merged per container id, a GATT Battery
Service reader with notifications on one worker thread, and a snapshot that waits for the first
enumeration so start-up never announces already-connected devices ([bluetooth → Implementation
notes](../modules/bluetooth.md#implementation-notes-m1-e2)). Remaining: the laptop recordings
(battery/charging and a Bluetooth connect with battery).

## M1-E3 · Settings window — agent: `muna-ui-engineer`

```text
Implement docs/modules/settings.md. Read docs/05-design-system.md (Settings surfaces) and
docs/adr/0004-module-contract.md (settings schema registration).

Scope:
- `settings` window (Tauri window, standard decorations) with sidebar + panes; panes for
  General, Layout, Multiple screens, Notch positioning, Appearance (shape, accent, reduced
  motion), Modules (enable/order), About/Diagnostics (export bundle).
- `muna-core::settings`: zod-mirrored schema (Rust serde + versioned migrations), atomic write
  to %APPDATA%\Muna\settings.json, import/export, per-monitor keyed by stable id.
- Live preview: changing layout settings updates the notch immediately via events.
- Tests: migration tests, import/export round-trip, Playwright flow for each pane.

Copy: sentence case, no exclamation marks; keys in packages/i18n/en/settings.json.
```

**Progress.** `feat(settings): settings window with sidebar, panes and live apply (m1-e3)`
landed the epic in one PR: the window shell (React Aria vertical `Tabs` sidebar, `@muna/ui`
`SearchField`, search index with synonyms, pane empty state), the seven M1 panes (General,
Layout, Notch position, Multiple screens, Appearance, Modules, About and diagnostics), the
cache-first write path with a 150 ms slider debounce and inline save errors, `SettingsChanged`
mirroring in both windows, settings v3 (`shell.moduleOrder` / `shell.disabledModules`, now
read and written by the notch's module bar) and the Rust commands `list_monitors`,
`export_settings`, `import_settings` and `open_logs_folder` over `tauri-plugin-dialog` /
`tauri-plugin-opener`. Import/export round-trip and migrations are `cargo test`; the pane
flows are Vitest (RTL) rather than Playwright until the e2e harness exists. Decisions —
native decorations, shape under Layout, reduce motion as a switch — are in
[settings.md → Implementation notes (M1-E3)](../modules/settings.md#implementation-notes-m1-e3).

## M1-E4 · Module bar & panel chrome — agent: `muna-ui-engineer`

```text
Build the expanded-panel chrome used by every module. Read docs/reference/ui-observations.md
(panel anatomy), docs/05-design-system.md (Panel, Module bar) and docs/06-motion-spec.md.

Scope: Panel (header 44 px with title + right icon rail incl. ⤡ collapse and pin), body
slot, footer slot; ModuleBar pill (640×40, icons per module, active indicator morph, reorder by
drag with pointer events, keyboard Left/Right, overflow rule); shared components Card,
ListRow, SegmentedControl, Slider, Toggle, EmptyState, ErrorState, Skeleton. Module switching
uses the shared-layout morph (content crossfade + height spring). Storybook stories for each
state; Vitest for keyboard nav and reorder.
```

**Progress.** `feat(ui): module bar and panel chrome (m1-e4)` landed the epic in one PR: eleven
`@muna/ui` primitives (`Button`, `Card`, `ListRow`, `SegmentedControl`, `Toggle`, `Slider`,
`EmptyState`, `ErrorState`, `Skeleton`, `PanelChrome`, `ModuleBar`) with every-state stories
and render/keyboard/reorder tests, the shell binding (`Panel` over `PanelChrome`, module bar
riding the panel's height spring, `switch` for module changes, `Ctrl+Tab` cycling, panel ∪
bar hit-rect) and four new S-suite scenarios. The panel is `role="dialog"` as the design
system said; the shell spec was corrected. Order persistence to `settings.json` moves to
M1-E3 with the settings write path. Decisions are in
[notch-shell.md → Implementation notes (M1-E4)](../modules/notch-shell.md#implementation-notes-m1-e4).

## M1-E5 · Onboarding — agent: `muna-ui-engineer`

```text
First-run flow shown in the settings window: welcome, choose display(s), choose Overlay vs
Reserved strip (with an animated explanation of the title-bar overlap trade-off), choose
Notch vs Island shape, permissions explainer (Bluetooth, notifications, webcam — request lazily
later), launch at login toggle, done. Read docs/01-product-vision.md (journeys) and
docs/05-design-system.md. Copy rules from .github/agents/muna-docs-writer.agent.md. Skippable,
re-openable from Settings → General.
```

**Progress.** `feat(onboarding): first-run welcome tour in the settings window (m1-e5)` landed
the epic in one PR: a 560 × 420 card (`apps/desktop/src/settings/onboarding/`) with seven
steps — welcome, choose your screens, placement, shape, permissions, start with Windows, done —
that write through the settings editor as choices are made, so the real notch previews them.
The placement trade-off is acted out with a token-built screen (`PlacementArt`) whose strip
and window move on the `reveal` / `layout` springs when the tile changes; no timers or loops.
Settings v4 adds `general.onboarded` (new profiles `false`, v3 files migrate to `true`); Skip
and Finish both set it, and General → Help → Welcome tour → Show again reopens the tour. The
screens step is left out on one screen. `@muna/ui` gained `OptionTiles` (radio tiles with an
illustration slot). Vitest covers the step order, focus handoff, every step's writes and the
gate in `SettingsApp`; Rust covers the migration. Decisions are in
[settings.md → Implementation notes (M1-E5)](../modules/settings.md#implementation-notes-m1-e5).

## M1 close — agent: `muna-architect`

**Done (2026-09-16).** The closing PR added the yield checklist
([qa/checklists/notch-shell.md](../qa/checklists/notch-shell.md)) and its driver
`scripts/qa/notch-yield.ps1`, and ran the ten scenarios against the dev build on Win11 25H2
with a 2560 × 1600 150 % primary and a 1920 × 1080 100 % secondary: 10 / 10 pass (Overlay run
Y1–Y9, Reserved run Y10 with Y1/Y6/Y7 as regression). The harness taught two lessons worth
keeping — hidden test windows let synthetic input reach real windows, and a System-DPI-aware
driver misreads a monitor with another scale factor — both recorded in the checklist. The exit
criteria are ticked in the roadmap with their evidence; the 4K-panel recording and the laptop
battery/Bluetooth recordings remain maintainer items because that hardware is not on the
development machine. M2 starts from [m2-media-hud.md](m2-media-hud.md).
