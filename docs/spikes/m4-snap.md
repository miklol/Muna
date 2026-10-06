# Spike M4-E3 · WinEvent hook thread for window drags (S3)

**Status:** Done — **Go** · **Validates:** the `WindowEvents` row of
[build-plan/m4-power-tools → Platform traits](../build-plan/m4-power-tools.md#platform-traits-new-in-muna-platform-all-scripted-in-fakeplatform)
and the platform notes of [window snap](../modules/window-snap.md#platform) ·
**Owner:** `muna-shell-engineer` · **Plan:** `muna-architect`, 2026-09-28 · **Run:** 2026-09-28

## Question

When the user starts dragging *another application's* window by its title bar, does the
`SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART / END)` hook that M1 already runs on the notch's
dedicated message-pump thread (`muna-platform::windows::pump`) tell the shell soon enough to
reveal the snap zones before the window reaches the notch — and does the thread stop with the
app, leaving no orphan?

Two things make this non-obvious:

- **Out-of-context delivery.** The hook is `WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS`,
  so every event is marshalled from the dragged application's thread into the pump thread's
  message queue, then across a `tokio::sync::broadcast` channel to the shell. Each hop is a
  queue; none is bounded in time by the API.
- **What "start" means to the OS.** `DefWindowProc` does not enter the move loop on the
  press: Windows first waits for the cursor to leave the drag rectangle
  (`SM_CXDRAG` / `SM_CYDRAG`, 4 px at 100 %) so that a click on a caption is not a drag. The
  event may therefore trail the press by an amount the hook cannot influence, and the shell
  must know which clock it is on.

Since M1 the event carried only `started: bool`; snapping needs the dragged window's handle
(`MoveSizeChanged { started, window }`) to filter its own windows and tool windows and to
place the right one at release. The spike test doubles as the check that the handle is the
dragged window's.

## How to run

Everything is scripted; the mouse moves for about two seconds and is put back. The test lives
next to the pump (`crates/muna-platform/src/windows/pump.rs`, `s3_*`) and needs a real
session:

```text
cd apps/desktop/src-tauri
cargo test -p muna-platform --lib --features platform-tests -- s3_a --nocapture
```

- **Helper process** — the test re-runs its own binary as `s3_helper_window`
  (`MUNA_S3_HELPER=1`), which creates a visible 320 × 160 `WS_OVERLAPPEDWINDOW` top-most
  window at (240, 240), prints `READY <hwnd> <x> <y> <w> <h>` and pumps messages until it is
  killed. A second process is essential: `WINEVENT_SKIPOWNPROCESS` means the hook never
  reports the test's own windows, exactly as it never reports the notch.
- **Gesture** — per round: start a fresh `Pump`, `SetCursorPos` to the helper's caption
  centre, `SendInput` left down, 10 ms, then four relative moves of 10 px at 10 ms intervals
  (the clock for MOVESIZESTART starts at the first move, see *Question*), wait for
  `MoveSizeChanged { started: true }`, 60 ms, left up, wait for `{ started: false }`, then
  stop the pump, timing each step (`Pump::stop`). Five rounds; min / median / max printed with
  `--nocapture`.
- **Probes** (one-off, not kept): the same test with the first move delayed 0 / 10 / 100 ms
  after the press, and with 1 / 4 / 8 moves, to learn which clock MOVESIZESTART follows.

## Environment

| Item | Value |
| ------ | ------- |
| Machine / GPU | Acer Predator PHN16-71 (i9 laptop, 32 threads, 16 GB) · NVIDIA GeForce RTX 4060 Laptop GPU + Intel UHD |
| OS build | Windows 11 Pro 10.0.26200 |
| Monitors (resolution @ scale; primary marked) | 2560 × 1600 @ 150 % (primary, only); the test binary is DPI-unaware, so both processes see the same virtualised coordinates |
| Tauri / wry / tao versions | not involved (crate-level test) · windows 0.61.3 · tokio 1 |
| Build | `muna-platform` debug unit tests, branch `m4-e3-window-snap` on top of `17b2677` |
| Foreground during the run | the terminal running `cargo test`; the helper is top-most |

## Exit criteria

| # | Criterion | Budget | Method | Measured | Result |
| --- | ----------- | -------- | -------- | ---------- | -------- |
| H1 | Hook delivery: OS raises → shell subscriber receives, within one frame | median ≤ 16 ms | `MOVESIZEEND` is raised synchronously on button-up, so button-up → `MoveSizeChanged { started: false }` isolates the hook → pump → broadcast path | 0.44 / 0.64 / 0.71 ms (min / median / max over 5 rounds) | **pass** |
| H2 | `MOVESIZESTART` arrives before the zones are due | slowest round ≤ 120 ms after the first movement (the motion spec's intent delay before the zones fade in) | first `MOUSEEVENTF_MOVE` → `MoveSizeChanged { started: true }` | 41.5 / 42.2 / 43.9 ms | **pass** |
| H3 | The event names the dragged window | `window` equals the helper's `HWND` in every round | assertion in the test | 5 / 5 rounds | **pass** |
| H4 | The pump stops cleanly | `WM_CLOSE` posted → window destroyed, hooks removed, session notifications unregistered ≤ 500 ms in every round; no orphan. The OS ends the thread afterwards, outside the stop ([#97](https://github.com/miklol/Muna/issues/97)) | `Pump::stop` timed step by step, five fresh pumps | 1.0 / 1.35 / 2.0 ms (2026-09-28, then still including the thread's exit) | **pass** |
| H5 | The fake scripts it | `FakePlatform::move_size_changed(started, window)` publishes the event; `WindowPlacement` is scripted with recorded calls | `cargo test -p muna-platform` | `move_size_and_lock_scripts_publish_events` + 5 placement unit tests green | **pass** |

Probe results (median MOVESIZESTART, measured from the press): first move 0 ms after the
press → 45.6 ms; 10 ms → 47.6 ms; 100 ms → 146.6 ms. With a single 10 px move → 29 ms; with
eight → 101 ms. The event follows the movement, not the press, and lands 20–50 ms after the
first movement past the drag rectangle depending on how the injected moves are spaced.

## Escape hatch

If H1 had failed (delivery > 16 ms), the pump would raise its thread priority to
`THREAD_PRIORITY_ABOVE_NORMAL` and, failing that, the shell would fall back to polling
`GetCursorPos` + `GetForegroundWindow` with `GetAsyncKeyState(VK_LBUTTON)` at the active poll
rate to detect a caption drag itself. If H2 had failed, the intent delay would start from the
first *cursor movement* the shell sees after `MOVESIZESTART` rather than from the event. If
H4 had failed, the pump would post `WM_QUIT` and detach after a bounded join instead of
blocking shutdown. None was needed at the time; the hosted CI runner later showed that the
OS's part of ending a thread can wait a second for the loader lock, and the pump no longer
joins its thread (see *Results*).

## Results

**Go.** The hook path is not the bottleneck: once the OS raises an event, the shell holds it
in well under a millisecond (H1), an order of magnitude inside the 16 ms budget. What trails
the press is the OS's own drag confirmation (H2): Windows commits to a move only after the
cursor leaves the drag rectangle and then takes a further ~20–50 ms with injected input. For
a hand on a mouse that is the first few pixels of the drag, long before the window nears the
top edge, and the motion spec's 120 ms intent delay starts only after that.

What the run taught us:

- **Measure the two clocks separately.** Button-down → `MOVESIZESTART` mixes the OS's drag
  detection with the hook; button-up → `MOVESIZEEND` is the hook alone. The kept test asserts
  on both: H1 on the end event, H2 on the start event against the intent delay.
- **`WINEVENT_SKIPOWNPROCESS` needs a second process to test.** The helper is the test binary
  itself under `--exact … s3_helper_window --ignored`, gated on an environment variable so the
  plain `--ignored` run does nothing.
- **A `tokio::time::timeout` must be built inside `block_on`.** Constructing it outside the
  runtime panics with "no reactor running" — a one-line trap for future hardware tests.
- **The handle is already there.** The pump's callback receives the dragged `HWND`; carrying
  it in `MoveSizeChanged` cost one field and lets the shell ask `WindowPlacement::is_snappable`
  before it commits to a snap session.
- **Injected input needs the desktop to itself.** Run under `--all-features` next to the other
  lab tests, the drag was never confirmed: `location::position_answers_or_says_why_not` had
  raised the Windows location consent dialog (`Shell_SystemDialog`) for the not-yet-seen test
  binary, which dims the whole desktop (`Shell_SystemDim`) and takes every click, and stays up
  well after that test gives up. Before every round the kept test checks that
  `WindowFromPoint` on the caption is the helper — failing by naming the cover, with its title
  and process, rather than clicking on whatever is there. A crate-wide desktop lock
  (`windows::test_support::desktop()`) that the consent-raising test took after a one-second
  grace period was not enough: the dialog outlives the lock, so whenever the drag test started
  late it ran under the dim ([#89](https://github.com/miklol/Muna/issues/89)). The location
  test is now an integration test (`crates/muna-platform/tests/location.rs`), which cargo runs
  after the lib's unit tests; the lock only keeps input tests from sharing the cursor.
- **Stop the pump, not the thread.** On the hosted runner H4 failed twice, at 0.95 s and
  1.32 s, both in the second round of the first, cold lib run, while other tests loaded DLLs
  for the first time (PDH, WMI, shell thumbnails)
  ([#97](https://github.com/miklol/Muna/issues/97)). Timing each step showed that the pump's
  own work was never the slow part: over about 4,500 stops under the parallel lib run on CI
  the whole stop had a p99 of 7–24 ms and a maximum of 35 ms, spread across `DestroyWindow`,
  the `WM_CLOSE` dispatch and the thread's exit. Holding the loader lock for 800 ms in a local
  experiment put 750 ms of the stop into the thread's exit, after the pump had cleaned up:
  ending a thread runs `DLL_THREAD_DETACH` and Rust's thread-local destructors under the
  process-wide loader lock, so any DLL load elsewhere in the process stalls a join. The pump
  now hands its step timings back over a channel once its window, hooks and session
  notifications are gone; `Drop` waits for that and lets the OS end the thread on its own.
  S3 still holds every round to 500 ms, names the slowest step when it fails, and prints when
  the thread actually ended.

### Consequences for Window snap (E3)

1. Keep the M1 pump as the only `WindowEvents` source; no polling fallback, no priority tweak.
2. `MoveSizeChanged { started, window }` is the platform event; the shell starts a snap
   session on `started: true` when `is_snappable(window)` holds and the module is enabled,
   raises the poll rate to *active* for the drag, and ends it on `started: false`.
3. The zones' 120 ms intent delay (docs/06-motion-spec.md) is counted from the moment the
   dragged cursor enters the hot zone, not from `MOVESIZESTART`; the event arrives far
   earlier, so the delay stays a pure intent filter.
4. `WindowPlacement` (frame bounds via `DWMWA_EXTENDED_FRAME_BOUNDS`, `SetWindowPos` with
   `SWP_ASYNCWINDOWPOS`, `ShowWindowAsync`) is the second half of the trait row; it never
   blocks a Muna thread on the dragged application.
