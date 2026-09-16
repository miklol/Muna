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
PR 2 covers `shell/machine.ts`, Strip/Panel, the S1–S14 suite and the fps evidence.

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

## M1-E5 · Onboarding — agent: `muna-ui-engineer`

```text
First-run flow shown in the settings window: welcome, choose display(s), choose Overlay vs
Reserved strip (with an animated explanation of the title-bar overlap trade-off), choose
Notch vs Island shape, permissions explainer (Bluetooth, notifications, webcam — request lazily
later), launch at login toggle, done. Read docs/01-product-vision.md (journeys) and
docs/05-design-system.md. Copy rules from .github/agents/muna-docs-writer.agent.md. Skippable,
re-openable from Settings → General.
```
