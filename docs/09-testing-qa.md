# 09 · Testing & QA strategy

Quality means three things for Muna: **it never gets in the way** (correct yielding,
click-through, focus), **it never slows the machine** (budgets), and **it feels right**
(fidelity). Each has its own test layer.

## Test pyramid

| Layer | Tool | Scope | Runs |
| ------- | ------ | ------- | ------ |
| Unit (TS) | Vitest + Testing Library | State machines, schedulers, selectors, formatters, components | Every PR |
| Unit (Rust) | `cargo test` with `FakePlatform` | Backends: SMTC session scoring, notification parsing, BT battery decoding, settings migrations | Every PR |
| Contract | tauri-specta snapshot + zod parse tests | TS ↔ Rust types never drift | Every PR |
| Component visual | Storybook + `@storybook/test-runner` + Playwright screenshots | Every module state (empty/loading/error/long/RTL/200 %) | Every PR |
| Integration (Windows) | Playwright over CDP against the debug build | Settings window flows; notch harness page driving the state machine | Every PR on `windows-latest` |
| Platform integration | `cargo test --features platform-tests -- --ignored` | Real SMTC/Core Audio/Bluetooth on a self-hosted lab machine | Nightly |
| Performance | `scripts/perf` (CDP metrics + PDH counters) | Idle CPU, RSS, fps during morph, start time | Nightly + release |
| Manual QA | `docs/qa/checklists/*.md` | Yield scenarios, multi-monitor, OSD, installers | Milestone close |

## Determinism rules

- Fake time everywhere: `vi.useFakeTimers()`; Rust `tokio::time::pause()`; the scheduler takes a
  `Clock` trait.
- Fake platform: `FakePlatform` implements every `platform::*` trait with scripted events
  (`push_media_session`, `set_battery`, `foreground_changed`). No test touches real OS APIs
  unless `--ignored`.
- Fixed viewport, DPI and reduced-motion flags in visual tests; fonts bundled.
- No sleeps; wait on events.

## What must be tested per module

Derived from the spec template in [`modules/README.md`](modules/README.md):

1. Every Given/When/Then acceptance criterion → a Vitest or cargo test, or a checklist row.
2. Strip form renders inside 2 slots; wide form truncates gracefully at 220 px.
3. `onHidden()` stops all timers/subscriptions (assert zero pending timers after hide).
4. Settings schema default + at least one migration test.
5. Storybook stories: `Default`, `Empty`, `Loading`, `Error`, `LongContent`, `RTL`, `ReducedMotion`.

## Notch shell scenario suite (harness page)

The harness mounts the real shell with `FakePlatform` and asserts state + shape rects:

| # | Scenario | Expected |
| --- | ---------- | ---------- |
| S1 | Cursor enters strip, waits 250 ms | HoverReveal; shape rects grow |
| S2 | Cursor crosses strip at 1200 px/s | Stays Collapsed |
| S3 | Hover 600 ms | Expanded, default module |
| S4 | Click outside | Collapsed immediately (shape settles within 600 ms) |
| S5 | Foreground window caption overlaps strip (Overlay mode) | Peek (6 px) |
| S6 | Fullscreen state reported | Parked; renderer paused |
| S7 | Move/size start → end | Peek during drag, restored after |
| S8 | Live activity arrives while Expanded | Queued, shown after collapse |
| S9 | HUD event while Collapsed | HUD form 1.5 s, returns to previous |
| S10 | Drop enters window | Drop tiles; leave → Collapsed |
| S11 | Pin, then focus text field | `NOACTIVATE` cleared; Esc restores |
| S12 | Monitor removed | Window destroyed; settings retained |
| S13 | DPI 100 → 200 % | Shapes re-published; sizes doubled |
| S14 | Reduced motion on | Durations ≤ 150 ms, no springs |

## Performance harness (`scripts/perf`)

1. Launch debug build with `--remote-debugging-port` and `MUNA_PERF=1`.
2. Warm-up 30 s. Sample **idle CPU** via PDH `\Process(muna*)\% Processor Time` (all processes,
   incl. WebView2) for 60 s → assert ≤ 0.3 %.
3. Start media (bundled test player publishing SMTC). Sample 60 s → assert ≤ 1 %.
4. Drive 20 expand/collapse cycles through the harness; capture `Performance.getMetrics` and
   `Tracing` frame events → assert p95 frame ≤ 17 ms (≥ 58 fps).
5. `Process.WorkingSet64` after collapse → assert ≤ 120 MB.
6. Cold start to first strip paint (log timestamp diff) → assert ≤ 1.5 s.
7. Emit `perf.json`; CI comments the trend on the PR; nightly fails on breach. Which steps run
   on PRs (`perf:smoke`) versus nightly (`perf:full`), and the regression rule, are defined in
   [11-ci-cd.md](11-ci-cd.md#performance-gates).

## Manual QA matrix (milestone close)

| Dimension | Values |
| ----------- | -------- |
| OS | Win10 22H2, Win11 24H2, Win11 Insider (informational) |
| Scaling | 100 / 125 / 150 / 200 % |
| Monitors | 1; 2 mixed DPI; 3 with one portrait; projector duplicate |
| Installer | MSIX, NSIS (+ external-location identity), portable dev build |
| Input | Mouse, touchpad, touch, keyboard-only, Narrator |
| Appearance | Dark/light wallpaper, high contrast theme, reduced motion |
| Apps | Spotify, Edge, Chrome, Apple Music, VLC, Teams (meeting), Steam game fullscreen |

Checklists live in `docs/qa/checklists/` (created per module by the QA agent).

## Bug workflow

Labels: `bug`, `jank`, `perf`, `crash`, `a11y`, `fidelity`, `platform:<api>`. Every bug needs a
repro, Windows build, monitor setup and the diagnostics bundle (Settings → Diagnostics →
Export: logs, settings, monitor topology, identity status). Crashes: `tauri-plugin-log` files
under `%LOCALAPPDATA%\Muna\logs`, plus Windows Error Reporting dump if present.

## Definition of done (per PR)

See `.github/PULL_REQUEST_TEMPLATE.md`. Reviewers check the evidence section before code.
