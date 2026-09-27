# 07 · Roadmap

Six milestones from empty repo to 1.0. Each milestone has **exit criteria** that must be
demonstrated (recording + numbers) before the next one starts. Epics map 1:1 to kickoff
prompts in [`build-plan/`](build-plan/README.md) and to `module` issues.

Tiers come from the [feature catalog](02-feature-catalog.md). Budgets come from the
[PRD](01-product-vision.md#performance--quality-budgets-enforced-in-ci-where-possible).

```mermaid
gantt
    dateFormat  YYYY-MM-DD
    axisFormat  %b
    section Foundations
    M0 Scaffold & spikes         :m0, 2026-09-21, 14d
    section Core
    M1 Shell & live activities   :m1, after m0, 21d
    M2 Media & HUD               :m2, after m1, 21d
    section Breadth
    M3 Daily modules (P1)        :m3, after m2, 28d
    M4 Power tools (P1/P2)       :m4, after m3, 28d
    section Ship
    M5 Polish, P2 tail, 1.0      :m5, after m4, 28d
```

Durations are planning estimates for one lead + agents; parallelism between epics inside a
milestone is expected.

---

## M0 · Foundations & spikes (2 weeks)

**Goal:** a repo where every later task has a place to land, and the two biggest technical
risks are measured.

Epics

- **M0-E1 Monorepo scaffold** — pnpm workspace, `apps/desktop` (Tauri v2 + React 19 + TS
  strict + Tailwind v4 + Motion), `packages/ui` (tokens, primitives, Storybook), `packages/contracts`
  (tauri-specta generated types + zod), `packages/i18n`, `apps/site` placeholder. ESLint/Prettier/
  Clippy/rustfmt, Vitest, Playwright, CI green on `windows-latest`.
- **M0-E2 Transparent-window spike** — one notch window per monitor with ADR-0002 rules;
  measure flash-free start, 100 collapse/expand cycles, monitor hot-plug, DPI change, Win10 + Win11.
  Decide: WebView pill vs native pill escape hatch.
- **M0-E3 Identity spike** — MSIX via `MakeAppx` + external-location manifest for NSIS;
  verify `NotificationChanged` fires; verify `StartupTask`; sign with a test cert. Verify
  Azure Artifact Signing / SignPath eligibility.
- **M0-E4 Design tokens & motion presets** — `packages/ui/src/tokens/tokens.css`, spring
  presets in `motion/presets.ts`, Storybook "Foundations" pages, reduced-motion switch.

Exit criteria

- [x] All required checks in `ci.yml` (`web`, `rust`, `deps`, `app`) run and pass on
  `windows-latest`/`ubuntu-latest`; root parity scripts from [11](11-ci-cd.md#local-parity) exist
  (M0-E1, [PR #3](https://github.com/miklol/Muna/pull/3)).
- [ ] `main` ruleset, `v*` tag ruleset, `release` environment and Dependabot configured per
  [11](11-ci-cd.md#protection-rules) (maintainer task; checklist delivered by M0-E3). Partly
  done and partly plan-blocked: Dependabot alerts + security updates, squash-only merges and
  read-only Actions permissions are on; rulesets and the protected `release` environment need
  GitHub Pro or a public repository — see the ticks in
  [11 › bootstrap checklist](11-ci-cd.md#bootstrap-checklist-maintainer-once).
- [x] `release.yml` dry run produces unsigned NSIS + MSIX artifacts
  ([run 34972995225](https://github.com/miklol/Muna/actions/runs/34972995225) from `main` @
  `57e8dcd`: NSIS setup 2.73 MB, MSIX 3.36 MB, external-location MSIX 8.7 KB, App Installer
  file, cargo + npm SBOMs; I9 row in `docs/spikes/m0-identity.md`).
- [x] Spike app shows a black strip on 2 monitors (mixed DPI) with zero flashes over 100 cycles;
  idle CPU ≤ 0.3 %, RSS ≤ 120 MB (numbers in `docs/spikes/m0-window.md`; Win11 25H2 — the
  Win10 22H2 column is a maintainer runbook). RSS passes only with the WebView2 switch set
  recorded in ADR-0002 (`--in-process-gpu`, one shared renderer); the default process model
  measured 181–223 MB — decision and guard in the spike's recommendation and risk R19.
- [x] Identity spike report with pass/fail per API (`docs/spikes/m0-identity.md`; Win11 25H2 —
  I1–I10 pass on both identity routes, `NotificationChanged` 8–10 ms with identity, polling
  fallback validated unpackaged; I11 signing route is a maintainer decision).
- [x] ADR-0001/0002/0003 updated to *Accepted (validated)* or amended (0001/0002 validated by
  M0-E2, 0003 amended by M0-E3; ticked by the M0 closing PR).

## M1 · Shell & live activities (3 weeks)

**Goal:** the notch exists, feels Apple-grade, and shows real system state.

Epics

- **M1-E1 Notch shell** — state machine ([notch-shell](modules/notch-shell.md)), Overlay and
  Reserved-strip modes, Notch/Island shapes, per-monitor placement, yield rules (caption overlap,
  fullscreen, drag), hit-testing, tray icon, single instance, autostart.
- **M1-E2 Live activities** — scheduler ([live-activities](modules/live-activities.md)),
  priorities, wide form, notices; sources: battery/charging, lock/unlock, Bluetooth connect
  (device name + battery), Pomodoro placeholder.
- **M1-E3 Settings window** — [settings](modules/settings.md): sidebar shell, General/Layout/
  Multiple screens/Notch positioning panes, schema + migrations, import/export, diagnostics
  export.
- **M1-E4 Module bar & panel chrome** — panel container, header, icon rail, module bar
  pill with reorder, keyboard navigation, Esc/pin behaviour.
- **M1-E5 Onboarding** — first-run: pick monitor, mode, shape; permissions explainer.

Exit criteria

- [x] Hover → expand → collapse morph at ≥ 58 fps on a 4K 150 % display; recording attached.
  **Measured** on 2560 × 1600 at 150 % (165 Hz): expand 158–167 fps, collapse 157–167 fps,
  0 dropped frames ([notch-shell → Implementation
  notes](modules/notch-shell.md#implementation-notes-m1-e1)). The notch window is sized in CSS
  px × scale (1680 × 720 physical at 150 %), so the morph renders the same pixels on a 4K 150 %
  display; the recording on an actual 4K panel is a maintainer item.
- [x] Notch yields correctly in 10 scripted scenarios
  ([`docs/qa/checklists/notch-shell.md`](qa/checklists/notch-shell.md)): 10 / 10 pass on
  2026-09-16 with `scripts/qa/notch-yield.ps1` (Peek 30 ms after a foreground change, drag
  201 ms, park 510–893 ms with the 500 ms debounce, Reserved-strip work area exact).
- [ ] Battery/charging and Bluetooth live activities demonstrated on a laptop. The reducers and
  the Windows Bluetooth watcher are tested (`tests/live_activities.rs`, `platform-tests`); the
  laptop recording is a maintainer item — the development machine is a desktop.
- [x] Settings persist across restart; import/export round-trip test passes.
  `muna-core::settings` `defaults_round_trip_through_json` and `per_monitor_layouts_round_trip`
  exercise the same `to_json` / `from_json` pair that `export_settings` / `import_settings`
  use; the dev profile's Compact strip height and a Reserved-mode edit of `settings.json` were
  in effect after every restart of the checklist run.

## M2 · Media & HUD (3 weeks)

**Goal:** the two features users see 100× a day are flawless.

Epics

- **M2-E1 Media backend** — SMTC sessions with scoring + WASAPI verification, thumbnails,
  timeline interpolation, controls, palette extraction, staleness watchdog.
- **M2-E2 Media UI** — strip (art + waveform), wide form on track change, panel (art, meta,
  progress, transport, volume, device picker, visualizer), lyrics (LRCLIB) optional.
- **M2-E3 HUD** — volume/brightness/mute HUD in the strip, native flyout suppression with
  watchdog, DDC/CI probe, scroll-to-volume.
- **M2-E4 Perf harness** — `scripts/perf` CPU/RSS/fps measurement in nightly CI.

Exit criteria

- [ ] Spotify, Edge/YouTube, Apple Music (Store), foobar2000 all show correct now-playing
  within 300 ms of change; wrong-session rate 0 in a 30-switch script. **Measured** with
  Spotify on Win11 25H2 via `scripts/qa/media-latency.ps1`: play 19–23 ms, pause 275–292 ms
  (Spotify's own fade-out), track change 71–86 ms; 0 wrong picks in the 30-switch script,
  which also runs against the fake platform in `tests/media.rs`
  ([media → Implementation notes (M2-E1)](modules/media.md#implementation-notes-m2-e1)). The
  Edge/YouTube, Apple Music and foobar2000 columns wait for the maintainer's machines
  ([qa/checklists/media](qa/checklists/media.md)).
- [ ] Idle CPU with media playing and strip visible ≤ 1 %; visualizer off when not visible.
  Not measured yet: the harness's idle window runs with nothing playing (0.003–0.014 %
  normalised; [notch-shell → Memory target](modules/notch-shell.md#memory-target)), and the
  media-playing window waits for the bundled SMTC test player deferred from M2-E4. The
  spectrum visualiser itself waits for WASAPI (M2-E2 shipped the SMTC-driven waveform).
- [ ] HUD replaces native flyout on Win11 24H2 and Win10 22H2; native restored after kill -9.
  **Measured** on Win11 25H2 (26200): flyout hidden 5 ms after the call, re-asserted ≤ 50 ms
  after a foreign restore, restored 19–31 ms after a hard kill against the 2 s budget
  ([hud → Implementation notes (M2-E3 PR A)](modules/hud.md#implementation-notes-m2-e3-pr-a)).
  Win11 24H2 (rows 1 and 14 on that build) and the Win10 22H2 `NativeHWNDHost` flyout (row 15)
  wait for hardware ([qa/checklists/hud](qa/checklists/hud.md)).

## M3 · Daily modules (4 weeks)

**Goal:** the P1 set people plan their day with.

Epics: **M3-E1 Calendar** (Graph + Google + ICS, meeting-join live activity), **M3-E2 To-do**,
**M3-E3 Pomodoro** (+ live activity), **M3-E4 Weather**, **M3-E5 Notifications** (identity
path + polling fallback, grouping, actions), **M3-E6 Day progress**, **M3-E7 Bluetooth panel**
(connect/disconnect, battery), **M3-E8 System monitor** (CPU/RAM/GPU/net/disk, top processes),
**M3-E9 Dashboard** (widget grid composing the above).

Exit criteria

- [ ] Every module has: backend tests with fake platform, Storybook states, acceptance tests,
  settings pane, i18n keys, spec status *Implemented*. **Built** for all nine in PRs
  [#28](https://github.com/miklol/Muna/pull/28)–[#36](https://github.com/miklol/Muna/pull/36):
  each has a Rust suite against `FakePlatform` (`tests/<module>.rs`), a Vitest suite for its
  strip, panel and settings pane, a settings pane and its keys in `en.json` (708 messages,
  `pnpm -w i18n:check`); the acceptance criteria are exercised by those suites rather than by a
  separate Playwright layer. Eight specs read *implemented (…)* with their deferrals listed
  under *Implementation notes*; [calendar](modules/calendar.md) stays *in progress* because
  only ICS subscriptions landed (Graph, Google and CalDAV are M4 work). **Missing**: the
  Storybook module states — the story harness landed with M4-E6
  (`apps/desktop/.storybook`, [09 → Module stories](09-testing-qa.md#module-stories-appsdesktopstorybook))
  with stories for the shortcuts pane, the palette and the key caps; the nine M3 modules still
  need their `Default / Empty / Loading / Error / LongContent / RTL / ReducedMotion` stories
  and remain the M3 carry-over.
- [ ] Dashboard renders all widgets at 60 fps while media plays; RSS ≤ 120 MB with all P1 on.
  Half measured: `pnpm -w ci:app` with every P1 module enabled and nothing playing gives
  37 MB private working set at idle and a 153 fps strip morph; the dashboard-while-media
  column needs the bundled SMTC test player deferred from M2-E4 and a manual `perf:full` run.
- [ ] Notifications module works in MSIX (events) and NSIS (polling) builds. The polling path
  ran in the unpackaged smoke (1 s poll, 0.55 % of one core idle after the projection cache);
  the MSIX `NotificationChanged` path is implemented and unit-tested but waits for a signed
  package ([qa/checklists/notifications](qa/checklists/notifications.md) rows 3 and 4).

## M4 · Power tools (4 weeks)

**Goal:** the features that make Muna a hub, not a widget.

Epics: **M4-E1 Drop actions** (tiles, IFileOperation, compress, share, eject), **M4-E2 Shelf**
(persist, drag-out, clipboard), **M4-E3 Window snap** (zones, drag tracking, layouts),
**M4-E4 Code hosting** (GitHub device flow, GitLab, PR/checks/notifications), **M4-E5 AI
coding status** (Claude Code / Codex / Copilot CLI adapters), **M4-E6 Keyboard shortcuts**
(global hotkeys, palette), **M4-E7 Notes**, **M4-E8 Screen time**.

Exit criteria

- [ ] Drop → tile → action round-trips on Explorer, browsers, Outlook attachments. **Built**
  in [#39](https://github.com/miklol/Muna/pull/39): Explorer and browser file drags reach the
  tiles through Tauri's drag-drop path (`CF_HDROP`), every action runs through
  `IFileOperation` against the fake in `tests/drop_actions.rs`; the Explorer and Chrome rows
  of [qa/checklists/drop-actions](qa/checklists/drop-actions.md) are the maintainer's manual
  pass. **Outlook attachments do not round-trip**: Outlook offers a virtual file, wry accepts
  `CF_HDROP` only (row 21, recorded as the Shelf's S2 question) — an `IDropTarget` of Muna's
  own would be the fix and is carried over.
- [ ] Shelf drag-out lands files in Explorer, Chrome upload, Teams. **Built** in
  [#40](https://github.com/miklol/Muna/pull/40): the shell's `DragSource` puts `CF_HDROP` on
  an OLE drag from the tile row (the row opts out of the webview's own HTML5 drag);
  Explorer, browser file inputs, Outlook and Teams are rows 15–18 of
  [qa/checklists/shelf](qa/checklists/shelf.md), a manual pass on the maintainer's machine.
- [ ] Snap positions correct on mixed-DPI monitors within 1 px (frame-bounds compensated).
  **Built** in [#41](https://github.com/miklol/Muna/pull/41): placement by
  `DWMWA_EXTENDED_FRAME_BOUNDS` with the invisible border added back, re-read 120 ms later and
  placed once more when an edge is off by more than 2 px (Aero Snap, per-monitor-DPI resize
  across monitors); zone geometry on a 100 % primary and a 150 % secondary is unit-tested in
  `tests/window_snap.rs`, the 1 px claim on real hardware is row 17 of
  [qa/checklists/window-snap](qa/checklists/window-snap.md).
- [ ] GitHub rate-limit friendly (ETag/poll-interval respected) in a 24 h soak. **Built** in
  [#42](https://github.com/miklol/Muna/pull/42) as one GraphQL request every two minutes,
  2 → 30 min backoff on failures, a stop on `Unauthorized`, paused while locked — ETag and
  `X-Poll-Interval` do not apply to GraphQL, so the criterion reads *one request per two
  minutes, never faster, `RateLimited` honoured*. The soak is row 29 of
  [qa/checklists/code-hosting](qa/checklists/code-hosting.md) and needs a token on a machine
  left on for a day.

## M5 · Polish, P2 tail & 1.0 (4 weeks)

Epics: **M5-E1 P2 modules** (Health, Translation, Mirror, Support), **M5-E2 Fidelity pass**
(design-reviewer audit of every surface vs reference screenshots; motion audit), **M5-E3
Accessibility** (screen reader names, keyboard, high contrast, reduced motion), **M5-E4 Release
engineering** (signed MSIX + NSIS, updater channel, release notes, Store readiness), **M5-E5
Landing site** (`apps/site`, downloads, docs), **M5-E6 Localization** (5 launch locales).

Exit criteria

- [ ] Zero *blocking* design-review findings; all budgets green in nightly perf for 14 days.
- [ ] Crash-free 7-day soak on 3 machines (Win10 laptop, Win11 desktop 3 monitors, Win11 tablet).
- [ ] Signed installers published from CI with release notes; update from previous build works.

---

## Post-1.0 candidates

Plugin API (third-party modules), Composition host-backdrop blur for Island shape, Spotify
Web API enrichment, Home/IoT tiles, Focus modes with app blocking, cross-device Nearby Share
receive, Store listing.

## Status tracking

| Milestone | Status | Started | Done | Notes |
| ----------- | -------- | --------- | ------ | ------- |
| M0 | Done | 2026-09-14 | 2026-09-15 | Landed by squash PRs [#3](https://github.com/miklol/Muna/pull/3) scaffold, [#5](https://github.com/miklol/Muna/pull/5) window spike, [#6](https://github.com/miklol/Muna/pull/6) identity spike + release scripts, [#7](https://github.com/miklol/Muna/pull/7) tokens & motion, [#8](https://github.com/miklol/Muna/pull/8) dependency overrides, and the closing PR. **Measured:** W1–W12 pass on Win11 25H2 — idle RSS ≈ 100 MB only with WebView2 `--in-process-gpu` + one shared renderer, 181–223 MB without (ADR-0002 amendment, risk R19; [`spikes/m0-window`](spikes/m0-window.md)); I1–I10 pass on both identity routes — `NotificationChanged` 8–10 ms with identity, 1 s polling fallback saw the toast in 28 ms unpackaged, sideload trust is machine-wide (ADR-0003 amendments; [`spikes/m0-identity`](spikes/m0-identity.md)); I9 dry run green (unsigned NSIS 2.73 MB, MSIX 3.36 MB, external-location MSIX, App Installer file, two SBOMs, 11 min on `windows-latest`); `@muna/ui` motion + shape modules and seven primitives — 78 tests, 58 stories with 0 axe violations ([build-plan/m0-foundations.md](build-plan/m0-foundations.md#m0-e4--design-tokens--motion-presets--agent-muna-motion-designer)). **Carried over:** Win10 22H2 columns of both spikes (maintainer runbook); I11 signing route; the plan-blocked items of the [bootstrap checklist](11-ci-cd.md#bootstrap-checklist-maintainer-once) (rulesets, protected `release` environment, secret scanning) plus `RELEASE_PLEASE_TOKEN` / `RELEASE_AUTOMATION`; `--text-3` contrast (3.7:1) design decision; flare morph → M1-E1; Linux-only `glib` Dependabot alert to dismiss. |
| M1 | Done | 2026-09-16 | 2026-09-16 | Landed by squash PRs [#10](https://github.com/miklol/Muna/pull/10) + [#11](https://github.com/miklol/Muna/pull/11) notch shell, [#12](https://github.com/miklol/Muna/pull/12) module bar & panel chrome, [#13](https://github.com/miklol/Muna/pull/13) + [#14](https://github.com/miklol/Muna/pull/14) live activities & Windows Bluetooth, [#15](https://github.com/miklol/Muna/pull/15) settings window, [#16](https://github.com/miklol/Muna/pull/16) onboarding, and the closing PR (yield checklist + harness). **Measured** on Win11 25H2, 2560 × 1600 at 150 % + 1920 × 1080 at 100 %: expand 158–167 fps / collapse 157–167 fps, 0 dropped ([notch-shell → Implementation notes](modules/notch-shell.md#implementation-notes-m1-e1)); the ten yield scenarios 10 / 10 — Peek 30 ms after a foreground change, silent maximise 422 ms, drag 201 ms, fullscreen park 510–893 ms, flapping never flickers, Reserved-strip work area exact ([qa/checklists/notch-shell](qa/checklists/notch-shell.md)); import/export round trip and v1→v4 migrations in `cargo test`. Epic notes: [notch-shell (M1-E4)](modules/notch-shell.md#implementation-notes-m1-e4), [live-activities](modules/live-activities.md#implementation-notes-m1-e2), [bluetooth](modules/bluetooth.md#implementation-notes-m1-e2), [settings (M1-E3)](modules/settings.md#implementation-notes-m1-e3), [settings (M1-E5)](modules/settings.md#implementation-notes-m1-e5). **Carried over:** the 4K-panel recording and the laptop battery/Bluetooth recordings (hardware the maintainer has); Win10 22H2 column of the yield checklist; Playwright pane flows wait for the e2e harness; S9/S10 arrive with HUD (M2) and Drop (M4); the M0 carry-overs still stand. |
| M2 | In progress | 2026-09-16 | | M2-E1 media backend: SMTC sessions with scoring, artwork pipeline and cache, now-playing strip activity, transport commands with the 2 s watchdog ([media → Implementation notes (M2-E1)](modules/media.md#implementation-notes-m2-e1)). **Measured** with Spotify via `scripts/qa/media-latency.ps1`: play 19–23 ms, pause 275–292 ms (Spotify's fade-out), track change 71–86 ms, artwork 0.8–2.1 s; 0 wrong picks in the 30-switch script (`tests/media.rs`). M2-E2 media UI: strip waveform and palette halo, wide-form marquee, panel with 96 px art, palette bleed, progress, transport and app pinning, Media settings pane persisting `settings.modules.media` ([media → Implementation notes (M2-E2)](modules/media.md#implementation-notes-m2-e2)); the bleed uses relative-colour `box-shadow`s after measuring the `color-mix` dither (62 → 0 speckles). Volume, output device, lyrics and the spectrum visualiser wait for WASAPI. Edge/YouTube, Apple Music and foobar2000 columns of the exit criteria wait for the maintainer's machines. M2-E3 HUD PR A: Core Audio volume/mute and mic mute, WMI + DDC/CI brightness, native flyout suppression with the `muna.exe --watchdog` restore, the `hud` module and its strip vocabulary ([hud → Implementation notes (M2-E3 PR A)](modules/hud.md#implementation-notes-m2-e3-pr-a)). **Measured** on Win11 26200: volume event 10.7 ms, brightness round trip 20.9 ms, flyout hidden 5 ms after the call, re-asserted ≤ 50 ms after a foreign restore, restored 19–31 ms after a hard kill (budget 2 s). Win10 22H2 flyout classes and external DDC/CI monitors are implemented but wait for hardware. M2-E3 HUD PR B: `LevelTrack` and the `level` strip slot with a 100 ms glyph crossfade, wheel-to-volume over the strip (while the HUD shows, or always with *Scroll on strip = volume*), track drag, and the *Volume and brightness* settings pane; the module registry now allows panel-less modules ([hud → Implementation notes (M2-E3 PR B)](modules/hud.md#implementation-notes-m2-e3-pr-b), [qa/checklists/hud](qa/checklists/hud.md)). M2-E4 perf harness: `scripts/perf` smoke and full plans, the `shell ready` and `webview memory target` log marks, JSON + PR-comment markdown ([build-plan/m2-media-hud.md](build-plan/m2-media-hud.md#m2-e4--performance-harness--agent-muna-qa-engineer)). Its first run exposed a shell ↔ UI ready loop (31 % of one core idle) and a leaking morph sampler, both fixed, and a memory miss (126 MB debug private working set) answered by the idle memory target ([notch-shell → Memory target](modules/notch-shell.md#memory-target)). **Measured** on Win11 25H2: idle CPU 0.003–0.014 % normalised, cold start 595–650 ms release / 520–870 ms debug, idle memory 17–31 MB after the trim (118–127 MB before). Deferred: bundled SMTC test player, media-playing CPU window, 4K emulation, `MUNA_FPS` overlay, automatic delta against `main`; morph driving and the first-morph-after-trim frame rate wait for an unlocked desktop. |
| M3 | In progress | 2026-09-26 | | M3-E3 Pomodoro: two-clock timer (monotonic countdown, wall-clock deadline for sleep), work / short break / long break cycle with auto-start, `pomodoro:timer` strip activity republished once a minute and the `pomodoro:finished` notice, SQLite session log for "N sessions today", panel with the 144 px ring dial, cycle dots, presets and transport, Pomodoro settings pane persisting `settings.modules.pomodoro` ([pomodoro → Implementation notes (M3-E3)](modules/pomodoro.md#implementation-notes-m3-e3)). Idle and paused timers hold zero timers; running ones wake every 5 s. Deferred: Quick/Custom presets, sound, Timer Done overlay, Focus Assist (with M3-E5), Focus Target (needs M3-E1/E2), hover-reveal strip controls. Stacked on the M2 stack (#27) and queued behind the same Actions budget. M3-E2 To-do: `muna-core::tasks` (migration 3, soft delete into a retention-bound trash), `TodoService` woken by commands, the next due boundary and unlock, `todo:due` strip activity (priority 55, 60 min lead, 15 min grace) and `todo:due:<id>` notice, contract (`get_todo_snapshot`, `todo_command`, `TodoChanged`), `Checkbox` and `TextField` primitives, panel with `chrono-node` quick-add and due preview, list segments, task rows and trash view, Tasks settings pane persisting `settings.modules.todo` ([todo → Implementation notes (M3-E2)](modules/todo.md#implementation-notes-m3-e2)). Deferred: sync (Microsoft To Do, Google Tasks), quick-add hotkey, notes, task rename, drag reorder, non-English date grammars. Stacked on #28. M3-E8 System monitor: pull-based `muna-platform::SystemStats` over `sysinfo` (CPU from the PDH idle counters, memory, volumes, hardware network counters, process walk grouped by executable) with scripted samples in the fake, `SystemMonitorService` owning the cadence (1 Hz while a notch window watches, 10 s while only the strip gauge is on, parked otherwise; CPU and rates differenced between consecutive samples, no reading across a gap over 30 s), opt-in `system-monitor:cpu` strip activity (priority 10), integer-only contract (`get_system_monitor_snapshot`, `system_monitor_watch`, `SystemMonitorChanged`; byte counts saturate at 2⁵³ − 1 through `Int53`), six-ring panel with the process table, System settings pane persisting `settings.modules["system-monitor"]` ([system-monitor → Implementation notes (M3-E8)](modules/system-monitor.md#implementation-notes-m3-e8)). Deferred: GPU (NVML behind a flag), temperatures, battery discharge rate. Task Manager parity is approximate ("% Processor Utility" vs the classic idle reading; working set vs private working set). Stacked on #29. M3-E7 Bluetooth panel: `BluetoothDeviceKind` from `System.Devices.Aep.Category` (segment match), best-effort `connect` (page the device, read `ConnectionStatus`), `disconnect` via `IOCTL_BTH_DISCONNECT_DEVICE` on the radio (nothing persisted; the journaled `BluetoothSetServiceState` plan dropped), radio state and toggle through `Windows.Devices.Radios` with `BluetoothRadioChanged`, all scripted in the fake; `BluetoothService` reducing reports into a connected-first snapshot, `bluetooth:low:<id>` notices once per threshold (20 orange, 10 red) per connection, blocking commands off the async threads; contract (`get_bluetooth_snapshot`, `bluetooth_command`, `BluetoothChanged`); panel with the radio switch, device rows with connect / disconnect and refusals in place, empty states for off, unavailable and nothing paired; Bluetooth settings pane persisting `settings.modules.bluetooth` (notices, hidden devices) ([bluetooth → Implementation notes (M3-E7)](modules/bluetooth.md#implementation-notes-m3-e7)). Deferred: classic HFP battery, AirPods adverts, nicknames and icons, opening Windows Settings from the empty state. Stacked on #30. M3-E4 Weather: `muna-platform::Location` (fake with scripted fixes and denials; Windows `Geolocator`, one `RequestAccessAsync` and one `GetGeopositionAsync` per refresh), Open-Meteo forecast and geocoding through a `reqwest` provider adapter, `WeatherService` reducer (locate → fetch with a generation counter, 15 min refresh, 1 → 15 min backoff, cache in `Store` meta keyed by the 0.01°-rounded point, *denied* sticks until *Try again*) on one tokio task woken by commands, settings and unlock; **off by default**, no request until the user turns it on, coordinates rounded before they leave the PC; contract (`get_weather_snapshot`, `weather_command`, `weather_search` refused while off, `WeatherChanged`; floats through the new `muna_core::Finite` specta marker); panel with the moment now, reading chips, twelve hours, seven days, gradient skies by condition and hour, the stale *Updated* chip and empty states for off, denied, unavailable, failed, loading and offline; Weather settings pane persisting `settings.modules.weather` (switch, current location or searched city, units) ([weather → Implementation notes (M3-E4)](modules/weather.md#implementation-notes-m3-e4)). Deferred: photographic skies and animated icons, alerts, a strip form. Stacked on #31. M3-E6 Day progress: pure UI over the to-do and pomodoro snapshots (through the contract, no cross-module imports) — `timeline.ts` with timed tasks due today, the running or paused focus block, an optional bedtime, completion over timed tasks only, the share of the working day gone and the first free stretch of at least 90 minutes; panel with the stats column and the timeline whose now row moves on the `layout` spring at every whole minute (one aligned timeout, cleared on unmount) and a *Long stretch* row handing over to the to-do module; Rust half owning `settings.modules.day-progress` (working hours, bedtime, strip bar, sources; minutes since local midnight, repaired identically on both sides) and the opt-in `day-progress:bar` strip activity (hourglass + progress, priority 5, working hours only, exact sleeps, local offset read at every wake); Day settings pane ([day progress → Implementation notes (M3-E6)](modules/day-progress.md#implementation-notes-m3-e6)). Deferred: calendar and health sources, the dashboard card (E9). Stacked on #32. M3-E9 Dashboard: `ModuleDefinition.widget` (`WidgetProps` with a span of 1 or 2) with a `widget.tsx` card for each of the seven P1 modules (media with transport on a wide card, pomodoro ring with start / pause, three soonest tasks, weather now with high / low, day-progress share and completion, CPU and memory rings watching only while mounted, connected Bluetooth devices with battery); the dashboard module rendering them in the 2 × 4 grid (spans 1–2, `layout` spring) with edit mode (controls replace the bodies: move, wider / narrower, remove; *Add a widget* card; Motion `drag` + pure `dropIndex`, off under reduced motion) and one persisted layout in `settings.modules.dashboard = { slots }` (contract `readDashboardSettings` / `writeDashboardSettings`; Rust validates the namespace and registers an idle `Panel` surface; disabled modules keep their slot but are not drawn); registered first as the default panel; Settings › Dashboard with counts and *Reset* ([dashboard → Implementation notes (M3-E9)](modules/dashboard.md#implementation-notes-m3-e9)). Deviation: the pencil is in the panel body, not the shell header rail. Deferred: profiles, launcher, actions, quick toggles, screenshot / info, widgets of modules that do not exist yet, the module story harness. Stacked on #33. M3-E1 Calendar (ICS slice): `muna-platform::Secrets` (fake vault; Windows Credential Manager through `CredWriteW` / `CredReadW` / `CredDeleteW`) keeping feed addresses out of the settings document, a permissive ICS reader of Muna's own with `rrule` recurrence, IANA and Windows zone names, overrides and cancellations over a ±60-day window, one `GET` per source per refresh period (5 / 15 / 30 / 60 min, 1 → refresh backoff, last good feed cached for an offline start), `CalendarService` reducer on a fake clock, `calendar:next` strip activity (*Event upcoming* 50 rising to *Event starting* 65 at ten minutes, 15 min grace) and the `calendar:starting:<id>` notice, contract (`get_calendar_snapshot`, `calendar_command`, `calendar_add_source`, `calendar_remove_source`, `calendar_open`, `CalendarChanged`), a `MonthGrid` primitive on React Aria `Calendar` (six rows, today circle, up to three event dots), the panel (month beside the day's agenda with *Join* / *Open*), the *Events* widget, Calendar settings pane ([calendar → Implementation notes (M3-E1)](modules/calendar.md#implementation-notes-m3-e1)). Deferred: Graph, Google, CalDAV, Windows `AppointmentStore`, search and filters, meeting awareness, refresh on expand, a press-to-act strip. Stacked on #34. M3-E5 Notifications: `muna-platform::Notifications` over `UserNotificationListener` (access and the consent prompt, the list with sender names and 48 px logos, `NotificationChanged` as `Push` where identity allows it and a 1 s `Polling` fallback otherwise, dismiss, clear, *Open* through `shell:AppsFolder`) plus `FocusSessionManager` read-only, all scripted in the fake; `NotificationsService` as a reducer diffing ids on every event or poll, one `notifications:arrived:<id>` notice per arrival from an unmuted sender (held while a focus session is on or Windows says busy or quiet hours) and the `notifications:unread` glance (logo, count in the new `count` trailing slot, "sender · title") until the panel marks everything read; contract (`get_notifications_snapshot`, `notifications_command`, `notifications_open_settings`, `NotificationsChanged`); the panel grouped by sender with logos or initials, two-line cards with relative times, hover-reveal *Open* / *Dismiss*, per-sender mute and clear, *Clear all*, the unread chip and *Focus on*, one explanatory state each for not asked, denied and unavailable; Notifications settings pane persisting `settings.modules.notifications` ([notifications → Implementation notes (M3-E5)](modules/notifications.md#implementation-notes-m3-e5)). Deviation: the unpackaged build polls instead of hiding the module; no `…` menu or filter chip. The catalog passing 700 messages pushed i18next's nested key types past TypeScript's instantiation limit, so `@muna/i18n` now hands i18next a flat catalog (`keySeparator: false`) — the JSON files and every `t('a.b.c')` call are unchanged. Deferred: reply and app protocols, the Win10 Focus Assist read, a press-to-act strip; the MSIX push column waits for a signed package. Stacked on #35. **Close-out:** all nine epics are built and documented; PRs [#28](https://github.com/miklol/Muna/pull/28)–[#36](https://github.com/miklol/Muna/pull/36) sit on the M2 stack ([#22](https://github.com/miklol/Muna/pull/22) → #24 → #25 → #26 → #27 → #28 → … → #36, [#23](https://github.com/miklol/Muna/pull/23) independent) and every one of them is held by the exhausted GitHub Actions budget, not by a failing check — each passes `pnpm -w ci`, `ci:rust`, `ci:deps`, `ci:app` and the docs checks locally. Carry-overs into M4: the module story harness and Storybook states for the nine modules, the dashboard-while-media 60 fps measurement (needs the SMTC test player), the MSIX notifications column, the Win10 22H2 columns of every checklist, Graph / Google / CalDAV calendar sources. |
| M4 | In progress | 2026-09-26 | | Plan, order and spikes in [build-plan/m4-power-tools → Plan](build-plan/m4-power-tools.md#plan-muna-architect-2026-09-26); stacked on the M3 close-out ([#37](https://github.com/miklol/Muna/pull/37)). M4-E6 Keyboard shortcuts: action registry (shell + module actions), `RegisterHotKey` bindings that register before they save and keep refused chords as *in use*, settings v5, the command palette and the shortcuts pane with a chord recorder; the desktop Storybook harness (`apps/desktop/.storybook`, fake IPC through `parameters.ipc`) with the first module stories, gated by `storybook:ci` ([keyboard-shortcuts](modules/keyboard-shortcuts.md#implementation-notes-m4-e6)). M4-E1 Drop actions: spike S1 recorded as *go* — Tauri's own drag-drop path reports *enter* 65–80 ms and *leave* 32 ms after the cursor crosses the strip's shape with the window never activating ([spikes/m4-drop](spikes/m4-drop.md)), so there is no native `IDropTarget`; drop sessions keep paths in Rust (`muna_core::drops`) while the UI sees names and kinds, the shell's `drop` state and `dragging` yield input (wins over Peek, loses to Park), `muna_platform::FileOps` (`IFileOperation` copy / move / recycle with Undo, *Open with*, reveal, share sheet on the window thread, USB eject through the devnode, folder picker) each on a short-lived STA thread, streamed cancellable zip / unzip with progress, the `DropActionsService` with jobs, strip activities and notices, contract (`get_drop_actions_snapshot`, `drop_run`, `drop_cancel`, `drop_cancel_job`, `drop_pick_folder`, `DropEntered` / `DropMoved` / `Dropped` / `DropLeft`, `DropActionsChanged`), the tile row as a new module surface (`ModuleDefinition.drop`) with the 30 ms stagger, hover grow and landing pulse, and the Drop actions settings pane (tiles in order, folders up to eight, expand notch, in-progress jobs) persisting `settings.modules["drop-actions"]`; stories for both ([drop-actions → Implementation notes](modules/drop-actions.md#implementation-notes-m4-e1), [qa/checklists/drop-actions](qa/checklists/drop-actions.md)). Deviation: no confirmation before recycling (Explorer's Undo is the safety net). Deferred: Shelf, Convert and Music tiles, a configured *Open with* app list, text and virtual-file drags (S2). Stacked on the E6 branch. M4-E2 Shelf: spike S2 recorded as *go* — `DoDragDrop` from a Tauri command on the main thread enters OLE 37–43 ms after the gesture and lands the file in Explorer and a browser file input with the strip never activating ([spikes/m4-drag](spikes/m4-drag.md)); `muna_platform::DragSource` (`SHDoDragDrop` with the shell's data object; *Copy* through `OleSetClipboard`) and `FileOps::thumbnail` (`IShellItemImageFactory` → PNG), `muna_core::shelf` (migration 4, references or copies under `%LOCALAPPDATA%\Muna\shelf`, snippets, expiry) and the `ShelfIntake` seam the *Shelf* drop tile parks through, `DropSessions::self_drag` so a release back over the strip re-adds nothing, the `ShelfService` (add, remove, clear, remove missing, open, reveal, copy, drag payloads that skip missing files, thumbnails cached per item, hourly expiry sweep), contract (`get_shelf_snapshot`, `shelf_command`, `shelf_thumbnail`, `ShelfChanged`; ids, names and sizes only — never a path), the panel (paste field, multi-select listbox with full keyboard use, drag-out of the selection, copy, missing state, empty state) and the Shelf settings pane persisting `settings.modules.shelf` ([shelf → Implementation notes](modules/shelf.md#implementation-notes-m4-e2), [qa/checklists/shelf](qa/checklists/shelf.md)). Deviations: the in-flight flag instead of a private clipboard format; `tauri-plugin-drag` not used. Deferred: clipboard history as a source, pasted bitmaps as items. Stacked on the E1 branch. M4-E3 Window snap: spike S3 recorded as *go* — the M1 pump's WinEvent hook holds an event in 0.64 ms median, `MOVESIZESTART` lands 42 ms after the first movement, the pump joins in 2 ms ([spikes/m4-snap](spikes/m4-snap.md)); `MoveSizeChanged { started, window }` and the `muna_platform::WindowPlacement` trait (eligibility filter, `DWMWA_EXTENDED_FRAME_BOUNDS`, `SWP_ASYNCWINDOWPOS` / `ShowWindowAsync` so a hung target never holds a Muna thread), `muna_core::snap::SnapSessions` keeping the handle in Rust, the shell's `snapping` yield input (holds the strip instead of Peek, loses to Park) and cursor reports per notch window, the `WindowSnapService` (halves, quarters, thirds and grid cells of the work area in physical px, work area re-read at apply, a verification pass 120 ms later against Aero Snap and per-monitor-DPI resizes), contract (`SnapDragMoved` / `SnapDragLeft` / `SnapDragEnded`, `snap_apply(session, label, zone)`, `snap_cancel`), the shell's `snap` state with the 120 ms intent timer and the 24 px hot zone tested against the rest boxes, the zones as a new module surface (`ModuleDefinition.snap`; glyph tiles, DOM hit-test, apply or cancel once) and the Window snap settings pane (a toggle per zone, an optional grid with rows, columns and gap, ten tiles in all) persisting `settings.modules["window-snap"]`; stories for both ([window-snap → Implementation notes](modules/window-snap.md#implementation-notes-m4-e3), [qa/checklists/window-snap](qa/checklists/window-snap.md)). Deviations: session-based contract instead of `SnapDragChanged { hwnd, cursor }`. Deferred: DWM thumbnail preview on hover. Stacked on the E2 branch. M4-E4 Code hosting: GitHub behind a personal access token — one GraphQL request per poll (`viewer`, the *review-requested* and *author* searches with the check rollup), every two minutes while on, connected and unlocked, backing off 2 → 30 min on failures and stopping on a refused token; the token in Credential Manager (`muna_platform::Secrets`) read at every poll, never logged and never in the settings document; the last queue cached in `Store` meta for an offline start and adopted as the notice baseline; `code-hosting:review:<id>` and `code-hosting:checks:<id>` notices (priority 45, three per poll at most) behind two settings; contract (`get_code_hosting_snapshot`, `code_hosting_command`, `code_hosting_connect` / `disconnect` / `open` / `open_token_page`, `CodeHostingChanged`); the panel with *To review / Mine / All* chips, rows with the author's initial, `repo #n`, the GitHub chip and the change line, ↗ through Rust and the one-line footnote for *Updated* or a failed poll; the *Review queue* widget; the pane with the masked connect form (`TextField secret`), *Create a token*, *Connected as* with *Disconnect* and the two notices, persisting `settings.modules["code-hosting"]` ([code-hosting → Implementation notes](modules/code-hosting.md#implementation-notes-m4-e4), [qa/checklists/code-hosting](qa/checklists/code-hosting.md)). Deviations: GraphQL instead of REST (no ETag / `X-Poll-Interval`), no `Http` platform trait, no avatars (CSP), a notice instead of a live activity for finished checks. Deferred: the device flow (S4, needs a client id), GitLab, Bitbucket, Jira, GitHub notifications. Stacked on the E3 branch. M4-E7 Notes: plain `.md` files in a folder (`%APPDATA%\Muna\notes` by default or a chosen folder, never created when missing) walked to a depth of four with dot-folders and symlinks skipped, the file stem as the title, excerpts from the first 4 KiB, CRLF normalised, saves that carry the baseline modified time and are refused on a conflict (`notes.conflict`), deletes through the Recycle Bin, pins in `Store` meta (`notes:pins`), full-text search capped at 100, no file watcher (every snapshot is a rescan); contract (`get_notes_snapshot`, `notes_command` refresh / pin / delete, `notes_create` / `open` / `open_inbox` / `save` / `rename` / `search` / `reveal` / `open_external` / `reveal_folder` / `pick_folder`, `NotesChanged`); the `TextArea` primitive; the panel — list with search (150 ms after the last keystroke), inline *New note*, rows with title, excerpt or sub-folder, when it changed and the pin glyph; the editor with 600 ms autosave, save on blur and close, rename, pin, markdown-lite preview (React elements, links shown not followed), *Show in Explorer* and *Move to Recycle Bin*; the `notes.quickNote` action opening *Inbox* with the caret at the end; the pinned-note widget; the Notes pane with *Change*, *Open folder* and *Use the default folder* persisting `settings.modules.notes` ([notes → Implementation notes](modules/notes.md#implementation-notes-m4-e7), [qa/checklists/notes](qa/checklists/notes.md)). Deviations: files, not SQLite (the module document's "plain `.md` readable by other apps" wins over the build plan's row). Deferred: a file watcher, a rich editor, clickable links, drag reorder. Stacked on the E4 branch. M4-E8 Screen time: no new hook — the shell's foreground, idle and lock signals become spans per lower-case executable in SQLite (migration 5: `usage_apps` with the display name, path, category override, exclusion and daily limit; `usage_sessions`), a 10 s tick only while on and unlocked that pauses at the moment input stopped (`Foreground::idle_for` over `GetLastInputInfo`), splits the open span at the day-reset hour, flushes once a minute, checks per-app limits (the `screenTimeLimit` strip notice, priority 42, once per app per day) and prunes 90 days back; lock closes, unlock reopens, a 30 s gap between ticks reads as sleep; `AppInfo::describe` for the version resource's display name and the shell icon (the shelf's `IShellItemImageFactory` renderer, not `SHGetFileInfoW`); the rule table of eight categories with the user's override; the snapshot (tracking state, the app in front with its 64 px icon, today's totals, the top 20 apps, the categories, the last seven days, the excluded list) published only while a notch window watches; contract (`get_screen_time_snapshot`, `screen_time_watch`, `screen_time_command` refresh / exclude / include / setCategory / setLimit / clearHistory, `screen_time_export` to a picked folder as `start,end,exe,app,category,seconds`, `ScreenTimeChanged`); the `SegmentedRing` primitive; the panel — head chips (total, switches), the *Week* chip, the donut with the legend and the session facts, the now card (*Away*, *Locked*, *Screen time is off*, *Nothing yet*), the ranking with limit bars that turn orange, the week as stacked bars with the daily average, an app's details with category chips, limit presets and *Exclude this app*; the widget with the small donut and what is in front; the Screen time pane with counting, *Pause after*, *Day starts at*, the excluded apps with *Include*, *Export CSV* and *Clear history* with an inline confirmation, persisting `settings.modules["screen-time"]` ([screen-time → Implementation notes](modules/screen-time.md#implementation-notes-m4-e8), [qa/checklists/screen-time](qa/checklists/screen-time.md)). Deviations: `AppInfo`, not `AppIcons`; exclude forgets the app's history (privacy over convenience). Deferred: browser-tab attribution, per-package UWP names (`applicationframehost.exe` counts as one system app), the 1-hour attribution measurement against a manual log. Stacked on the E7 branch. M4-E5 AI coding status: the `Processes` trait (`main_window`, `owner_of_local_port` over `GetExtendedTcpTable`); the loopback hook receiver (hyper on `127.0.0.1`, a configured port with ten retries, a per-install bearer token in `Store` meta, 64 KiB bodies, 30 req/s, a `PermissionRequest` held up to 25 s for the strip's answer, `/health`, `/hooks/claude`, `/hooks/generic`); Claude Code through seven `http` hooks written and removed in `~\.claude\settings.json` by the pane, its transcript tailed for usage and the branch read from `HEAD`; Copilot CLI through `inuse.<pid>.lock` and `events.jsonl` under `~\.copilot\session-state` on a 2 s / 10 s cadence, nothing while off or locked; the generic document for any other process; the `ai-coding:waiting:<session>` activity (priority 62, `Trailing::Decision`) for a decidable prompt and a notice for every other stop; contract (`get_ai_coding_snapshot`, `ai_coding_watch`, `ai_coding_command` refresh / allow / deny / focus / dismiss / installClaudeHooks / removeClaudeHooks, `AiCodingChanged`); the `DecisionButtons` primitive and the strip's `decision` slot wired through the shell; the panel (counts, rows with the status dot, chips, what the agent waits for, the meta line, *Allow* / *Deny*, *Show*, *Dismiss*, *Recent*), the widget and the AI coding pane (switches, port, listening state, hook URL, *Install hooks* / *Remove hooks*) persisting `settings.modules["ai-coding"]` ([ai-coding → Implementation notes](modules/ai-coding.md#implementation-notes-m4-e5), [qa/checklists/ai-coding](qa/checklists/ai-coding.md)). Deviations: a configured port, not a random one; the token in `Store` meta, not Credential Manager; no `SendInput('y')` fallback. The parity run found two bugs the unit tests could not: `main_window` messaging a window of Muna's own process from a worker holding the module lock (a startup deadlock whenever a Copilot session was live; own-process windows are now skipped before any caption call, with a live regression test) and the CLI's one-turn-per-response log (13 091 `turn_end`s for 33 prompts read as 13 091 stops; the turn now ends only after a response without `toolRequests`). Deferred: Cursor and Codex adapters, Copilot token counts, terminal-title watching, a two-phase poll that reads outside the module lock. Stacked on the E8 branch as [#45](https://github.com/miklol/Muna/pull/45). **Close-out:** all eight epics built and stacked as [#38](https://github.com/miklol/Muna/pull/38) → [#45](https://github.com/miklol/Muna/pull/45) on the M3 close-out ([#37](https://github.com/miklol/Muna/pull/37)); the four exit criteria are built and unit-tested against the fake platform, their real-hardware columns wait for the maintainer (above). **Measured** in the last `ci:app` of the stack (debug build, Win11 25H2): cold start 658–1220 ms warm, idle CPU 0.026–0.089 % normalised, private working set 32.6–35.5 MB after the idle trim with every P1 and P2 module on. Merge order and carry-overs in [build-plan/m4-power-tools → Stack and merge order](build-plan/m4-power-tools.md#stack-and-merge-order). |
| M5 | In progress | 2026-09-27 | | Plan, order and spikes in [build-plan/m5-ship → Plan](build-plan/m5-ship.md#plan-muna-architect-2026-09-27); stacked on the M4 close-out ([#46](https://github.com/miklol/Muna/pull/46)). Built so far: E1a Support & diagnostics ([#47](https://github.com/miklol/Muna/pull/47)), E1b Health ([#48](https://github.com/miklol/Muna/pull/48)) — see [Progress](build-plan/m5-ship.md#progress). E4 release engineering runs off the stack with the maintainer's secrets. |

Update this table (and module spec statuses) when a milestone closes.
