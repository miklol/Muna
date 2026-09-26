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
- Fake platform: `FakePlatform` implements every `muna_platform` trait (`Media`, `Audio`,
  `Bluetooth`, `Power`, `Monitors`, `Foreground`) with scripted events
  (`push_media_session`, `set_battery`, `foreground_changed`). No test touches real OS APIs
  unless `--ignored`.
- Fixed viewport, DPI and reduced-motion flags in visual tests; fonts bundled.
- No sleeps; wait on events.

## Where Rust tests live

- `muna-core` and `muna-platform`: ordinary `#[cfg(test)]` modules next to the code.
- The `muna` crate (Tauri binary): **integration tests in `apps/desktop/src-tauri/tests/`
  only**. Its lib and bin are built with `test = false` because a test harness that links Tauri
  needs the comctl32 v6 manifest, which `build.rs` can embed only for `[[test]]` targets
  (otherwise the harness aborts with `STATUS_ENTRYPOINT_NOT_FOUND`). A `#[cfg(test)]` module
  added inside `muna` would silently never run.
- Run everything with `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
  --all-features`; `default-members` makes that cover all three crates.

## What must be tested per module

Derived from the spec template in [`modules/README.md`](modules/README.md):

1. Every Given/When/Then acceptance criterion → a Vitest or cargo test, or a checklist row.
2. Strip form renders inside 2 slots; wide form truncates gracefully at 220 px.
3. `onHidden()` stops all timers/subscriptions (assert zero pending timers after hide).
4. Settings schema default + at least one migration test.
5. Storybook stories: `Default`, `Empty`, `Loading`, `Error`, `LongContent`, `RTL`, `ReducedMotion`.

### Module stories (`apps/desktop/.storybook`)

Desktop stories live next to the source (`*.stories.tsx`) and run in the app's own Storybook
(`pnpm -w storybook:desktop`, port 6007); `storybook:ci` builds and axe-tests it after the
design system's. The preview extends `@muna/ui/storybook` and adds what a module needs to
render outside Tauri:

- `parameters.ipc` — fake commands by name (`get_hotkeys: () => bindings`). A Storybook loader
  installs them through `@tauri-apps/api/mocks` before the story renders, so a component's
  first `commands.*` call on mount already gets an answer; `refuse(code, message)` from
  `src/storybook/ipc.ts` fails a `typedError` command the way Rust does. Events are routed
  in-page, so a story may `emit()` what a component listens for. Unmocked commands reject
  loudly and log a warning.
- `parameters.settings` — the document `get_settings` returns (a value or a recipe over
  `defaultSettings()`); `update_settings` round-trips through it.
- `parameters.window` — `notch` (default) or `settings`, which sets `body[data-window]` and the
  window label so the right stylesheet applies.
- `src/storybook/frames.tsx` — `PanelFrame` (the expanded island with the shell's `Panel`
  header) for panels and `SettingsPaneFrame` (column width, title, `SettingsEditorProvider`)
  for settings panes. Stories keep the module's `titleKey`; i18n and a primed query cache come
  from the preview.

Interaction states use `play` functions (`storybook/test`); the axe opt-outs the design-system
runner accepts (`parameters.a11y.config.rules`, each with a comment saying why) apply here too.

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

**Where the suite runs (M1-E1).** The harness page is not built yet; the scenarios run as
Vitest + Testing Library against the real `NotchWindow` — Motion springs complete under fake
timers hoisted before the first import, so the tests assert settled geometry and morph reports
(`apps/desktop/src/shell/notch-window.test.tsx`: S1–S8, S11, S13, plus hotkey, pin, press,
scroll-down and the wide form; `machine.test.ts` covers the reducer alone) — and as
`cargo test` against `FakePlatform` for the decisions Rust owns
(`apps/desktop/src-tauri/tests/shell_model.rs`: S5 including the peek hit-rect translation,
S6, S7, S12, debounce, `AppBar`, press outside; `tests/live_activities.rs`: S8's queueing,
the power, session and Bluetooth reducers and the module registry). S8 is split across the
two: the UI half proves the strip is suspended while the panel shows and resumed 150 ms after
the collapse settles, the Rust half that a notice published meanwhile queues and is released
on resume. S14 is `morph-transition.test.ts` and
`packages/ui/src/motion/reduced-motion.os.test.tsx`. S9 arrives with the HUD (M2) and S10
with Drop (M4). Hardware evidence is measured with
`scripts/dev.ps1 -HitTest -FullMotion` and the `morph` lines in `%LOCALAPPDATA%\Muna\logs`;
numbers are recorded in
[notch-shell.md → Implementation notes](modules/notch-shell.md#implementation-notes-m1-e1).
When driving the notch with synthetic input (`SetCursorPos`), nudge the cursor once after the
shell has made the window interactive: Windows sends no `WM_MOUSEMOVE` for a cursor that is
already resting there, whereas a real mouse always does.

## Performance harness (`scripts/perf`)

`node scripts/perf/index.mjs --smoke|--full [--out perf.json] [--markdown perf.md] [--exe path]
[--baseline earlier.json] [--morphs N] [--verbose]` — `pnpm -w perf:smoke` / `perf:full`. Pure
logic (budgets, plans, statistics, report) lives in `report.mjs` and is unit-tested; `probe.ps1`
is the Win32 helper (process tree, CPU time, private working set, notch window rects, cursor).

1. Launch the built app (`target/debug/muna.exe`, else `release`; `--exe` overrides) with a
   scratch `LOCALAPPDATA` profile and `--autostart`, so the first-run settings window stays
   closed and nothing from the developer's profile leaks in. The single-instance plugin means a
   running Muna makes the run fail fast ("exited before the shell was ready").
2. **Cold start**: wall time from process spawn to the shell's `shell ready label="notch"` log
   line (the notch's first painted frame) → assert ≤ 1.5 s. The in-process
   `since_start_ms` is reported as a detail.
3. Park the cursor away from the notch. Warm up (smoke 5 s, full 30 s), then sample **idle CPU**
   as the delta of `TotalProcessorTime` over every process of the tree (`muna.exe`, the OSD
   watchdog, the WebView2 browser, renderer and utility processes) over the window (smoke
   30 s, full 60 s), normalised to all logical processors like Task Manager → assert ≤ 0.3 %.
   The one-core figure is reported alongside.
4. **Memory**: private working set summed over the tree every 5 s (smoke, until 90 s) or 10 s
   (full, until 300 s). The shell asks WebView2 for its low memory target 30 s after the cursor
   left the notch while nothing on the strip animates ([modules/notch-shell.md](modules/notch-shell.md#memory-target));
   the gated value is the median of the samples taken at that target (the last sample when the
   trim never ran, with a note) → assert ≤ 120 MB. The pre-trim median is reported too.
5. Full mode only: drive 20 expand/collapse cycles by drifting the cursor onto the strip below
   the hover-intent velocity, waiting for the shell's `morph` log lines (frames, duration,
   longest frame, dropped) and parking the cursor again → assert the slowest morph ≥ 58 fps.
   Memory is sampled once more after the last collapse.
6. Write the JSON report and the markdown the `app` job posts on the PR (with the
   `<!-- muna-perf-report -->` marker); exit 1 on any breach or when nothing was measured.
   `--baseline` renders a delta column against an earlier JSON. Which steps run on PRs
   (`perf:smoke`) versus nightly (`perf:full`) is defined in
   [11-ci-cd.md](11-ci-cd.md#performance-gates).

Not yet automated: the media-playing CPU window (≤ 1 %; needs a bundled SMTC test player) and
the 4K emulation pass. The harness runs against whatever build the workflow made — today the
debug build in both `ci.yml` and `nightly.yml` — so its startup and CPU numbers are upper
bounds for the release build (the report says so in a note).

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

Checklists live in `docs/qa/checklists/` (created per module by the QA agent). Where a checklist
can be driven, its script lives in `scripts/qa/` and prints one `PASS` / `FAIL` / `SKIP` line
per scenario with the measured latency; the first is
[checklists/notch-shell.md](qa/checklists/notch-shell.md) with `scripts/qa/notch-yield.ps1`
(ten yield scenarios against a running Muna, own test windows only); the second is
[checklists/media.md](qa/checklists/media.md) with `scripts/qa/media-latency.ps1` (media-key
presses timed against the module's log); [checklists/hud.md](qa/checklists/hud.md) is manual
(volume, brightness, wheel and drag over the strip, the flyout after a hard kill), as is
[checklists/notifications.md](qa/checklists/notifications.md) (consent states, MSIX push and
NSIS polling, focus and busy holds, capture hiding);
[checklists/drop-actions.md](qa/checklists/drop-actions.md) pairs with the scripted drop spike
(`scripts/spikes/drop/index.mjs` for the enter / over / leave timing) and covers the sources,
tiles and hardware by hand; [checklists/shelf.md](qa/checklists/shelf.md) pairs with the
scripted drag-out spike (`scripts/spikes/drag/index.mjs` for the gesture-to-OLE latency and the
Explorer and browser targets) and covers Outlook, Teams, copies, thumbnails and missing files
by hand; [checklists/window-snap.md](qa/checklists/window-snap.md) pairs with the S3 hook test
next to the pump (`cargo test -p muna-platform --features platform-tests -- s3_a` for the hook
latency and the drag-start clock) and the fake-platform zone table (`tests/window_snap.rs`),
and covers real drags, exact placement on mixed DPI, elevated and UWP windows and the grid by
hand.

## Bug workflow

Labels: `bug`, `jank`, `perf`, `crash`, `a11y`, `fidelity`, `platform:<api>`. Every bug needs a
repro, Windows build, monitor setup and the diagnostics bundle (Settings → Diagnostics →
Export: logs, settings, monitor topology, identity status). Crashes: `tauri-plugin-log` files
under `%LOCALAPPDATA%\Muna\logs`, plus Windows Error Reporting dump if present.

## Definition of done (per PR)

See `.github/PULL_REQUEST_TEMPLATE.md`. Reviewers check the evidence section before code.
