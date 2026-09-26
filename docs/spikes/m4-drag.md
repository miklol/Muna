# Spike M4-E2 · Drag-out from the webview (S2)

**Status:** Done — **Go** · **Validates:** the `DragSource` row of
[build-plan/m4-power-tools → Platform traits](../build-plan/m4-power-tools.md#platform-traits-new-in-muna-platform-all-scripted-in-fakeplatform)
and the first acceptance criterion of [shelf](../modules/shelf.md) ("Drag a Shelf item into
Outlook/Teams → attaches the file") · **Owner:** `muna-shell-engineer` · **Plan:**
`muna-architect`, 2026-09-27 · **Run:** 2026-09-27

## Question

Can a drag that *starts* as a pointer gesture inside the WebView2 (pointer down on a Shelf
item, 6 px of movement) be handed to OLE — `DoDragDrop` with a shell data object, called on
the main thread from a Tauri command while the button is still down — so that the file lands
in Explorer and in a browser's file input, with the webview never starting an HTML5 drag of its
own?

Three things make this non-obvious:

- **Mouse capture.** Chromium captures the mouse on button-down in the WebView2 child window;
  OLE's `DoDragDrop` captures it again for its own window. Both windows belong to the main
  thread, so the second capture should simply take over (the webview sees
  `WM_CAPTURECHANGED` and ends its gesture) — but the notch window is `WS_EX_NOACTIVATE` and
  never the foreground window, and `SetCapture` from a background thread only holds while a
  button is down and the thread owns the button. If the lock does not apply, the drag freezes
  the moment the cursor leaves the notch window.
- **Latency.** The gesture is detected in the webview, crosses IPC, and is queued to the main
  thread. If the button is released before `DoDragDrop` runs, OLE's default
  `QueryContinueDrag` drops at once wherever the cursor is — possibly back on the notch, which
  would arrive as a `Dropped` event of our own.
- **HTML5 drag.** Chromium starts an OLE drag itself for `draggable` elements, images, links
  and selected text. A Shelf item is an image with a name; the row must opt out
  (`draggable=false`, `user-select: none`, `dragstart` prevented) or two drags compete.

## How to run

Everything is scripted; no hand on the mouse. The driver starts the debug build with a private
profile and `MUNA_SPIKE=drag` (the shell arms the notch root as a drag source for one temporary
file the driver created and named in `MUNA_SPIKE_DRAG_FILE` — see `get_drag_spike` in `ipc.rs`
and `useDragSpike` in `src/lib/drag-out.ts`), waits for `shell ready`, opens the two targets at
known positions, then drives a real button-down → glide → release with `SendInput` while the
app's log lines are timestamped on stdout.

```text
pnpm --filter @muna/desktop tauri build --debug --no-bundle   # once
node scripts/spikes/drag/index.mjs [--out target/spike-results/drag.json] [--verbose] [--skip-edge]
```

Close any other notch utility or top-centre overlay first: the driver refuses to run when a
window other than `MunaNotch` owns the pointer over the strip.

- **Targets** — `scripts/spikes/drag/probe.ps1 explorer <folder> <x> <y> <w> <h>` opens an
  Explorer window on an empty temporary folder and places it with `SetWindowPos` (the window is
  found through `Shell.Application.Windows()`); `probe.ps1 edge <page> <x> <y> <w> <h>` opens
  Microsoft Edge (`--app`, fresh `--user-data-dir`) on a page whose whole body is a drop zone
  over an `<input type="file" multiple>`; the page writes `S2:<names>` into `document.title`,
  which the probe reads back with `GetWindowTextW`. Both windows are raised past the foreground
  app (`HWND_TOPMOST` then `HWND_NOTOPMOST`) and the driver checks with `WindowFromPoint` that
  the target really owns the drop point before each pass.
- **Reveal** — before every gesture the hand rests 900 ms on the strip's top edge
  (`probe.ps1 hover`). A foreground window whose caption overlaps the strip leaves the notch
  *peeking* (a 6 px lip of click-through pixels below it), and only the hover-intent reveal
  makes the strip grabbable.
- **Gesture** — `probe.ps1 drag <x0> <y0> <x1> <y1>`: move to the strip's centre, dwell 250 ms
  (the hit tester flips the click-through flag), `SendInput` left down, 12 hops of ≈ 2 px
  over 100 ms (past the 6 px threshold), 24 hops to the target over 400 ms, dwell 300 ms,
  left up. One JSON line per phase on stdout with `QueryPerformanceCounter` timestamps.
  `probe.ps1 click <x> <y>` is the control for G6: a press that never becomes a drag.
- **What the app logs** (`[INFO]`): `drag out requested label= items=` when the command
  arrives, `drag out started wait_ms=` when `DoDragDrop` is entered on the main thread,
  `drag out finished dropped= effect= ms=` when it returns (`[WARN] drag out failed error=`
  if it did not run); `[WARN] ui … message=drag out html5 dragstart` if the webview raised
  `dragstart` during the gesture (the hook prevents it and reports it). Paths never reach the
  log.
- **Foreground** — `probe.ps1 foreground` before and after each pass; a notch window must never
  be the foreground window.

## Environment

| Item | Value |
| ------ | ------- |
| Machine / GPU | Acer Predator PHN16-71 (i9 laptop, 32 threads, 16 GB) · NVIDIA GeForce RTX 4060 Laptop GPU + Intel UHD |
| OS build | Windows 11 Pro 10.0.26200 |
| Monitors (resolution @ scale; primary marked) | 2560 × 1600 @ 150 % (primary, only) |
| WebView2 runtime | 153.0.4234.48 (Evergreen) |
| Tauri / wry / tao versions | tauri 2.11.5 · wry 0.55.1 · tao 0.35.3 · webview2-com 0.38.2 · windows 0.61.3 |
| Build | `muna.exe` debug (`tauri build --debug --no-bundle`), branch `m4-e2-shelf` on `0353f11` |
| Foreground during the run | a maximised Tauri app (`Tauri Window`), so the notch idled in *peek* |

## Exit criteria

| # | Criterion | Budget | Method | Measured | Result |
| --- | ----------- | -------- | -------- | ---------- | -------- |
| G1 | The gesture reaches OLE while the button is down | `drag out started` ≤ 100 ms after the hop that crosses 6 px; `DoDragDrop` does not return before the release | driver timestamps vs. the log lines | started 37 ms after the hop (queued 0 ms on the main thread); returned 77 ms *after* the release | **pass** |
| G2 | The drag follows the cursor out of the notch window | Explorer shows the copy cursor over its file list (the drop lands, see G3) — no freeze at the window edge | pass 1 outcome | landed; the drop point was 626 px below the strip, 306 px inside the notch window's (click-through) bounds | **pass** |
| G3 | Explorer receives the file | the temporary file exists in the target folder ≤ 2 s after the release; outcome `dropped`, effect `copy` | pass 1: folder listing + log | 78 ms after the release; `dropped=true effect="copy"` | **pass** |
| G4 | A browser's file input receives the file | Edge's window title becomes `S2:<name>` ≤ 2 s after the release | pass 2: `probe.ps1 title` | `S2:muna-s2-drag.txt` 220 ms after the release | **pass** |
| G5 | The webview starts no drag of its own | no `drag out html5 dragstart` line in either pass | log | 0 lines in 4 passes + the control | **pass** |
| G6 | The strip never activates | per drag pass no more `notch window focused` lines than a plain press (the control); the foreground window before and after each pass is never `MunaNotch` | log + `foreground` probe | control 1 line, 4 drag passes 0 lines; foreground `Tauri Window` → `CabinetWClass`, `Chrome_WidgetWin_1`, `Tauri Window`, `CabinetWClass` | **pass** |
| G7 | Cancel is clean | pass 3 (release back over the notch): outcome `cancelled` or a drop with no effect, the file is not duplicated, the UI is responsive (a following `shell_ready` round trip) | log + a fourth pass repeating pass 1 | pass 3 `dropped effect=copy` (our own inbound drop target accepted it), scratch folder unchanged, no duplicate; pass 4 landed 80 ms after the release | **pass** |

Start latency over the four passes: 37 / 37 / 39 / 43 ms; `DoDragDrop` returned 1–79 ms after
the release. Whole run 27.5 s. Raw data: `target/spike-results/drag.json`.

## Escape hatch

If G2 fails (the drag freezes at the window edge because the background thread's capture does
not hold), the drag is started from a hidden `WS_EX_TOOLWINDOW` *drag proxy* window that the
UI asks Rust to place under the cursor on pointer-down: the proxy receives the real
`WM_LBUTTONDOWN`, owns the button and calls `DoDragDrop` from its own message loop — the same
trait, a different `start_drag`. If G4 fails only for the browser (Explorer fine), the Shelf
ships with the Explorer, Outlook and Teams targets and the browser row is recorded as a known
gap. If G1 fails because the gesture crosses IPC too slowly, the UI lowers the threshold to the
first `pointermove` after a 150 ms press and the row shows a *drag* affordance on press. HTML5
`DownloadURL` drags (Chromium's virtual-file format through the asset protocol) stay a last
resort: they cannot carry an existing file's path, so Explorer would materialise a copy.

## Results

**Go.** All seven criteria pass on the first complete run; the escape hatch is not needed.
`DoDragDrop` called from a Tauri command on the main thread takes the mouse over from the
WebView2 child window cleanly: the webview ends its own gesture on `WM_CAPTURECHANGED`, the
OLE loop follows the cursor out of the `WS_EX_NOACTIVATE` notch window and into Explorer and a
browser file input, and the strip never becomes the foreground window.

What the run taught us, in the order the harness hit it:

- **A drag needs a revealed strip.** With a maximised app in the foreground the notch idles in
  *peek*: a 6 px lip whose pixels are click-through. The gesture only works after the
  hover-intent reveal (≈ 250 ms hover → `hoverReveal` → `expanded`). S1 never noticed because
  an *inbound* OLE drag reveals the strip by itself. The Shelf UI must therefore only arm rows
  that are actually visible — which it does by construction, since rows exist only in the
  expanded panel.
- **Competing notch utilities take the pointer.** Another "notch" app on the host
  (a Qt `QWindowToolSaveBits` full-screen layered window above ours in z-order) owned the
  pointer over the strip; no event reached the webview. The driver now names the offender and
  refuses to run. Recorded as an open question in [notch shell](../modules/notch-shell.md#open-questions):
  two notch apps cannot share the top-centre, and diagnostics should say which window owns it.
- **Self-drop is real.** Releasing back over the strip is a drop onto our own inbound drop
  target (M4-E1 drop-actions): OLE reports `dropped effect=copy`, and in two of three runs the
  target logged a `drag enter` for it. The Shelf must mark its drags as its own and the inbound
  target must ignore them meanwhile (see [shelf → Behaviour](../modules/shelf.md#behaviour);
  how, under *Consequences* below).
- **Pressing the webview activates the window once.** WebView2 calls `SetFocus` on any
  primary-button press, which logs `notch window focused` for the `WS_EX_NOACTIVATE` window —
  once per process, before any drag, and equally for a plain click (the control). The drag
  itself adds nothing; the foreground window never changes. G6 was re-worded to compare
  against the control instead of demanding zero lines; the pre-existing focus is a known
  observation of the [notch-shell QA checklist](../qa/checklists/notch-shell.md).
- **The desktop parked the notch** (`fix(shell)`, landed with this spike). When Windows made
  `Progman` the foreground window after the targets closed, the borderless monitor-sized
  desktop passed the PILLAR fullscreen test and the notch parked off-screen — exactly what
  [notch-shell Y3](../qa/checklists/notch-shell.md) forbids. `is_fullscreen` now returns
  `false` for `Progman` and `WorkerW`.
- **Targets opened by a background process come up behind the foreground app**, and a drop
  that misses lands on whatever is there (a Tauri app accepted the file with effect `copy`).
  Edge additionally opens an untitled first-run dialog in front of its `--app` window even with
  `--no-first-run`. The harness raises its windows past the foreground, closes Edge's extra
  windows and verifies with `WindowFromPoint` before every pass.
- **Latency budget.** Pointer-down → 6 px → IPC → main thread → `DoDragDrop` is 37–43 ms with
  the main-thread hop queued for 0 ms, well inside the 100 ms budget; the UI shows no
  intermediate affordance.

### Consequences for the Shelf (E2)

1. Keep `DragSource::start_drag` as designed; no drag-proxy window.
2. Ignore our own inbound drag events while a drag out is in flight. Built as an in-process
   guard (`DropSessions::self_drag()`, held for the life of the `DoDragDrop` call and checked
   first in the shell's drag-drop handler) rather than the private clipboard format this run
   suggested: the shell's own data object carries the file list, so a format of ours would
   have meant wrapping it, and the flag answers the same question without touching OLE.
3. Rows are the drag handles; `draggable=false` + `user-select: none` + `dragstart` prevented
   stay (G5 held with them in place).
4. Documentation: the "two notch apps cannot share the top-centre" note and the
   `Progman`/`WorkerW` rule are in [notch shell](../modules/notch-shell.md) (Placement, Open
   questions); the self-drop rule is in [shelf](../modules/shelf.md#behaviour).
