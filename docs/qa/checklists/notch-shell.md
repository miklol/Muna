# QA checklist · Notch shell yield scenarios

The ten scripted scenarios behind the M1 exit criterion *"Notch yields correctly in 10 scripted
scenarios"* ([07-roadmap](../../07-roadmap.md#m1--shell--live-activities-3-weeks)). They exercise
the yield rules of [notch-shell.md → Placement](../../modules/notch-shell.md#placement) on real
Windows: caption overlap, window drag, fullscreen, the park debounce, per-monitor attribution
and Reserved-strip mode. The automated suites cover the same decisions with `FakePlatform`
([09-testing-qa](../../09-testing-qa.md#notch-shell-scenario-suite-harness-page)); this checklist
proves them against the real window manager, DWM and `SetWinEventHook`.

## Running it

`scripts/qa/notch-yield.ps1` drives every scenario and prints one `PASS` / `FAIL` / `SKIP` line
with the measured latency. It needs a running Muna (`scripts/dev.ps1` or an installed build) with
the primary notch in the default layout (Overlay, Notch shape, no offsets; any strip height).

```powershell
pwsh scripts/qa/notch-yield.ps1                                  # all ten, Overlay mode
pwsh scripts/qa/notch-yield.ps1 -Scenario Y7,Y8,Y9 -Report out/yield.md
pwsh scripts/qa/notch-yield.ps1 -Scenario Y10 -Reserved          # after switching Layout → Placement
```

How it observes the notch, without touching anything but its own windows:

- **Test windows** are WinForms forms in child `pwsh` processes: a white captioned window, a
  small captioned *side* window that never overlaps the strip, a dark borderless window sized to
  a whole monitor (the fullscreen stand-in) and a white borderless, never-activated backdrop
  behind the strip.
- **Hit-testing**: `WindowFromPoint` under a resting cursor — `MunaNotch` means the strip is
  interactive there, anything else means it yielded (click-through).
- **Parking**: the `MunaNotch` window rect sits fully above its monitor.
- **Peek**: the mean luminance of the strip's lower band against the white backdrop — black at
  rest, bright once the strip slid up to the 6 px sliver.
- **Drag**: a real caption drag with the mouse button held (synthetic input), so
  `EVENT_SYSTEM_MOVESIZESTART` fires like it does for a user.

The script is per-monitor DPI aware, like Muna, so every coordinate is a physical pixel on every
monitor. It refuses to run a scenario whose test window is not visible or whose click point is
covered by a real window (then `SKIP`), and it exits with the number of failed scenarios.

## Scenarios

Timings in *Expected* come from the spec: Peek within 100 ms of a foreground change, the 500 ms
quiet-state poll for silent maximise, the 500 ms park debounce, the 40 % caption-overlap
threshold.

| Id | Scenario | Setup | Steps | Expected | Automated coverage |
| --- | --- | --- | --- | --- | --- |
| Y1 | Nothing in the way | Captioned window in the foreground, well below the strip | Rest the cursor on the strip, then on the 6 px sliver at the top edge | Strip black at rest; `MunaNotch` under the cursor at both points; window placed (not parked) | S1 in `notch-window.test.tsx`; `shell_model.rs` strip-rest rect |
| Y2 | Maximised window takes the foreground | The captioned window maximised; a side window in the foreground; cursor resting on the strip's lower band | `SetForegroundWindow` on the maximised window without moving the mouse | Hit rect leaves the band within 100 ms (`WindowFromPoint` no longer `MunaNotch`); the sliver stays `MunaNotch`; strip visibly up | S5 (`shell_model.rs`: caption overlap → Peek, peek hit-rect translation) |
| Y3 | Foreground moves elsewhere | Continues Y2 | Foreground to the side window; then click the bare desktop low on the primary monitor (only when the desktop really is under the cursor) | Strip back at rest; the desktop (`Progman` / `WorkerW`, borderless and monitor-sized) never parks the notch | `yield_rules` tests: rule clears; fullscreen heuristic needs `WS_POPUP` or no caption *and* ≥ 90 % coverage |
| Y4 | Maximise the foreground window | Captioned window restored and in the foreground | `SW_MAXIMIZE` (raises no foreground event) | Strip visibly up within ≈ 500 ms + slide (quiet-state poll re-samples the rect) | `shell_model.rs`: foreground re-sample |
| Y5 | Caption overlap threshold | Captioned window at the top edge | Right edge at 30 % of the strip's width, then moved to 50 % without changing the foreground | 30 % never peeks; 50 % peeks after the next poll | `yield_rules::caption_overlaps` unit tests |
| Y6 | Window drag | Captioned window restored, cursor on its caption | Press, move 6 × (12, 6) px, hold 600 ms, release | Window moves; strip up during the whole drag; back after release (`EVENT_SYSTEM_MOVESIZESTART/END`) | S7 (`shell_model.rs`: `MoveSizeChanged`) |
| Y7 | Fullscreen parks the notch | Borderless monitor-sized window on the primary | Bring it to the foreground; then minimise it and refocus the captioned window | Parked ≈ 500 ms after the foreground change (debounce), placed again ≈ 500 ms after it left | S6 (`shell_model.rs`: fullscreen → Parked, renderer paused) |
| Y8 | Fullscreen on the other monitor | Two monitors; borderless window sized to the secondary | Bring it to the foreground | Only the secondary notch parks; the primary never moves; secondary placed again after it left | `yield_rules::monitor_of` + `decide` per-monitor tests |
| Y9 | Flapping fullscreen | Y7's window | 4 × (200 ms fullscreen / 200 ms away), then hold fullscreen | Never parks during the flapping; the held fullscreen parks after the debounce and unparks after leaving | `ParkDebounce` tests |
| Y10 | Reserved-strip mode | Settings → Layout → Placement → *Reserved strip*; run with `-Reserved` | Maximise the captioned window | Its frame top equals the strip's bottom and the work-area top; nothing peeks | `shell_model.rs`: `AppBar` reserve/release; `layout::reserved_height` |

Y2, Y4 and Y5 are skipped in Reserved mode (caption overlap cannot happen there); Y8 is skipped
with one monitor; Y10 is skipped in Overlay mode. Lock (`WTS_SESSION_LOCK` → Parked) and
*Pause on this display* are covered by `shell_model.rs` and are not scripted: locking the
session would interrupt the operator.

## Results

| Date | Build | Machine | Result |
| --- | --- | --- | --- |
| 2026-09-16 | `main` @ `d091671` (dev build) | Win11 25H2, desktop; `\\.\DISPLAY1` 2560 × 1600 at 150 % (165 Hz, primary) + `\\.\DISPLAY5` 1920 × 1080 at 100 %; Compact strip | **10 / 10 pass** — Overlay run: Y1–Y9 pass, Y10 skipped; Reserved run (`-Reserved`): Y1, Y6, Y7, Y10 pass |

Measured on that run:

| Id | Measured |
| --- | --- |
| Y1 | Strip black at rest; `MunaNotch` under the cursor at the strip and at the sliver; window placed |
| Y2 | Hit rect left the strip **30 ms** after the foreground change (criterion ≤ 100 ms); sliver still `MunaNotch`; strip visibly up |
| Y3 | Strip back 9 ms after the side window took the foreground; desktop check skipped — a real window covered the spot on this desktop |
| Y4 | Strip visibly up **422 ms** after `SW_MAXIMIZE` (poll ≤ 500 ms + slide) |
| Y5 | 30 % overlap: no peek within 1.5 s; 50 % overlap peeked after **330 ms** |
| Y6 | Window moved; strip up **201 ms** after the drag began, still up after 600 ms; back 12–35 ms after release |
| Y7 | Parked **510–756 ms** after the fullscreen window took the foreground (debounce 500 ms); placed again 512–514 ms after it left |
| Y8 | Secondary parked after **893 ms**; primary never parked; secondary placed again after 510 ms |
| Y9 | No park during 4 × (200 ms fullscreen / 200 ms away); held fullscreen parked after 537 ms; placed again after 511 ms |
| Y10 | Maximised frame top 39 px = work-area top = strip bottom (Compact strip at 150 %); strip did not slide up |

Y7–Y9 park between 510 and 893 ms rather than at the 500 ms debounce: the foreground event
fires while the stand-in window is still restoring from the minimised state, so the snapshot
that finally covers the monitor can come from the next 500 ms quiet-state poll, and the
debounce starts from there.

## Still to run (maintainer)

- Keyboard shortcuts (M4-E6, [spec](../../modules/keyboard-shortcuts.md)): with the
  borderless stand-in of Y7 in the foreground, `Ctrl+Alt+Space` must still open the panel
  (`RegisterHotKey` reaches a fullscreen borderless window); `Ctrl+Alt+N` must park the notch
  under the cursor for the configured 15/30/60 min and the *only while hovering* option must
  drop presses while the cursor is away from the strip. Bind a chord another app holds (for
  example PowerToys' `Win+Shift+T`) and confirm the red *In use by another app* state with the
  old binding kept, then re-launch Muna and confirm the row still shows it.
- Win10 22H2 column of the same ten scenarios (the fullscreen heuristic and `SHAppBarMessage`
  behave the same on paper; not measured).
- A single-monitor laptop at 100 % and 125 %, and a portrait secondary monitor.
- An exclusive-fullscreen D3D game (the borderless stand-in covers the PILLAR heuristic; the
  `SHQueryUserNotificationState` route — `RUNNING_D3D_FULL_SCREEN` — needs a real game).
- Performance on an unlocked desktop (M2-E4 measured with the session locked, where the
  notch is parked): `pnpm -w perf:full -- --exe apps/desktop/src-tauri/target/release/muna.exe`
  must drive its 20 morphs and report the slowest ≥ 58 fps; then leave the cursor away from
  the notch for ≥ 60 s (the log shows `webview memory target target=Low`), hover, and read the
  first `morph` line — the panel must still open at ≥ 58 fps after the trim. Record both
  numbers in [notch-shell → Memory target](../../modules/notch-shell.md#memory-target).

## Harness notes

Lessons from writing the driver, so the next checklist does not repeat them:

- `Start-Process -WindowStyle Hidden` hides the *first* window the child shows, WinForms
  included; the host shows its form again with `SW_SHOWNA`. The first run of this checklist had
  invisible test windows: every scenario except the drag still passed, because Muna's rules read
  the foreground rect and not the pixels, but the synthetic drag pressed on a real window
  underneath. Hence the visibility and `WindowFromPoint` guards.
- A System-DPI-aware driver sees monitors with a different scale factor in virtualised
  coordinates (the 100 % secondary read as 2880 × 1620 at (−2880, −437) from a 150 % primary),
  and the rounded parked position missed by a pixel. Per-monitor awareness v2 makes every
  coordinate physical.
- Enumerate the notch windows with `EnumWindows`, not a `FindWindowEx` chain: the shell
  re-asserts topmost while you walk the z-order and a window goes missing.
- After Rust flips the notch from click-through to interactive, a resting synthetic cursor gets
  no `WM_MOUSEMOVE`; nudge it once (a real mouse always moves).
