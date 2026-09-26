# Spike M4-E1 · Drop on the notch window (S1)

**Status:** Recorded · **Validates:** the `DropTarget` row of
[build-plan/m4-power-tools → Platform traits](../build-plan/m4-power-tools.md#platform-traits-new-in-muna-platform-all-scripted-in-fakeplatform)
and the first acceptance criterion of [drop-actions](../modules/drop-actions.md) ·
**Owner:** `muna-shell-engineer` · **Plan:** `muna-architect`, 2026-09-26

## Question

Does Tauri's own drag-drop path (`dragDropEnabled: true` → wry's `IDropTarget` on the WebView2
child windows → `WindowEvent::DragDrop`) report *enter*, *over* with coordinates and *leave*
while Explorer drags files over the transparent, click-through, non-activating notch window —
fast enough for the tiles to show within 120 ms — or does the shell need its own `IDropTarget`
on the top-level window?

Two things make this non-obvious:

- The notch window is `WS_EX_TRANSPARENT` (click-through) except while the cursor is over a
  shape the UI published ([hit_test.rs](../../apps/desktop/src-tauri/src/shell/hit_test.rs)).
  OLE finds the target with `WindowFromPoint`, which skips click-through windows, so *enter*
  can only arrive after the hit tester has flipped the flag — at 60 Hz once the cursor is inside
  the window bounds. The question is whether OLE re-targets on the next mouse move.
- wry registers its target on the WebView2 child windows it enumerates once at creation, and
  only accepts `CF_HDROP` (files); text or URL drags produce no events at all.

## How to run

Everything is scripted; no hand on the mouse. The driver starts the debug build with a private
profile (the perf harness's `App`), waits for `shell ready`, starts an OLE drag source in a
second process and moves the cursor along a fixed path through the primary strip while the
app's log lines are timestamped on stdout.

```text
pnpm --filter @muna/desktop tauri build --debug --no-bundle   # once
node scripts/spikes/drop/index.mjs [--out target/spike-results/drop.json] [--verbose]
```

- **Drag source** — `scripts/spikes/drop/drag-source.ps1` (Windows PowerShell 5.1, STA,
  WinForms): a hidden form calls `DoDragDrop` with a `FileDrop` data object holding one
  temporary file. `QueryContinueDrag` keeps the drag alive (no mouse button is down, so the
  default answer would end it) until `-HoldMs` elapse, then answers *Cancel* (pass 1) or *Drop*
  (pass 2). One JSON line per phase on stdout.
- **Cursor path** — `probe.ps1 cursor` (`SetCursorPos`, physical px): from 400 CSS px below
  the strip — still inside the 480 CSS px-tall window, so the cursor never leaves the window
  bounds — to the strip's centre in 12 steps over ≈ 200 ms, a 600 ms dwell with 1 px jitter
  (OLE only re-targets on mouse moves), then back out and a 400 ms dwell. The driver stamps
  the first hop that lands inside the strip rect and the first hop that lands outside it.
- **What the app logs** (`shell::manager`, `[INFO]`): `drag enter label= count= x= y=` on
  `DragDropEvent::Enter`, `drag leave label= overs= …` summarising the *over* stream on
  `Leave`, `drag drop label= count= …` on `Drop`, and `notch window focused` (`[WARN]`) if a
  notch window ever gains focus. Paths never reach the log — counts and coordinates only.
- **Foreground** — `probe.ps1 foreground` (`GetForegroundWindow` + class name) before and
  after each pass.

## Environment

| Item | Value |
| ------ | ------- |
| Machine / GPU | Acer Predator PHN16-71 · NVIDIA GeForce RTX 4060 Laptop GPU + Intel UHD Graphics |
| OS build | Windows 11 Pro 25H2, 10.0.26200 |
| Monitors (resolution @ scale; primary marked) | 2560 × 1600 @ 150 % (primary); notch window 1680 × 720 physical at (440, 0) |
| WebView2 runtime | 153.0.4234.48 (Evergreen) |
| Tauri / wry / tao versions | tauri 2.11.5, wry 0.55.1, tao 0.35.3 |
| Build | `muna.exe` debug (`tauri build --debug --no-bundle`), commit `640c824` + the instrumentation in this PR |

## Exit criteria

| # | Criterion | Budget | Method | Measured | Result |
| --- | ----------- | -------- | -------- | ---------- | -------- |
| D1 | *Enter* arrives once the cursor is over the strip | ≤ 100 ms after the cursor command that first lands inside the strip rect (leaves ≥ 20 ms of the 120 ms for the morph) | driver timestamps vs. the `drag enter` line | 65 ms (run 2); 80 ms (run 1) · one *enter*, client (840, 21) | pass |
| D2 | *Over* carries coordinates | ≥ 3 *over* events during the 600 ms dwell; first and last position inside the window's client rect | `overs`, `first`, `last` on the `drag leave` line | 15 overs (run 2); 20 (run 1) · first (840, 21), last (840, 69) | pass |
| D3 | *Leave* arrives once the cursor is out | ≤ 100 ms after the cursor command that first lands outside the strip rect (the cursor stays inside the window bounds) | driver timestamps vs. the `drag leave` line | 32 ms · the last *over* is the first hop below the strip (y = 69 > 48) | pass |
| D4 | The strip never activates | no `notch window focused` line; `GetForegroundWindow` unchanged and never a `MunaNotch` window | log + `foreground` probe before / after | 0 focus lines; foreground before = `Tauri Window` (settings, hidden), after = the drag source's WinForms window then `Tauri Window`; never `MunaNotch` | pass |
| D5 | *Drop* delivers the items | `count` on the `drag drop` line equals the files dragged (1), position inside the client rect | pass 2 | count 1 at (841, 21) after 28 overs; the source sees `DragDropEffects.Copy` | pass |
| D6 | Nothing runs when nothing is dragged | the idle CPU budget of `ci:app` is unchanged (no polling was added for drags) | `pnpm -w ci:app` perf smoke | 0.023 % normalised (0.74 % of one core), 44.9 MB private, low target at 30 s | pass |

## Escape hatch

If D1 or D3 fail because OLE never re-targets the window after the click-through flag flips,
the shell registers its own `IDropTarget` on the top-level notch `HWND` behind
`MUNA_DROP_TARGET=native` and clears `WS_EX_TRANSPARENT` for the duration of a drag it learns
about from `DragEnter` on a 1 px-tall, never click-through sentinel window along the strip's
top edge. If D5 fails (wry's `enter_is_valid` gate), the same native target takes over the
drop. Either way the trait stays `muna_platform::DropTarget`; only the implementation moves.

## Results

**Go: Tauri's own drag-drop path is enough.** No native `IDropTarget`, no sentinel window, no
feature flag. The `DropTarget` trait stays in `muna-platform` for the tests, with the Windows
implementation being the shell manager's `WindowEvent::DragDrop` handler.

Two runs of `node scripts/spikes/drop/index.mjs` on the environment above (JSON in
`apps/desktop/src-tauri/target/spike-results/drop.json`):

| Run | D1 enter | D2 overs in 600 ms | D3 leave | D4 activation | D5 drop | Source (pass 1 / pass 2) |
| ----- | ---------- | -------------------- | ---------- | --------------- | --------- | -------------------------- |
| 1 | 80 ms | 20 | *(mis-stamped, see below)* | none | 1 item at (841, 21), Copy | None / Copy |
| 2 | 65 ms | 15 | 32 ms | none | 1 item at (841, 21), Copy | None / Copy, 63 queries |

- Run 1 reported D3 as 5 580 ms: the driver took the "out" timestamp when the glide *finished*
  rather than at the first hop outside the strip, so the number was measured against the wrong
  reference and included the whole outbound glide plus the 400 ms dwell — yet the `drag leave`
  line itself arrived right after the last *over* at y = 69. The driver now stamps the first hop
  that leaves the strip rect, and run 2 measures 32 ms. Nothing in the app changed between the
  runs.
- D6: `pnpm -w ci:app` after the instrumentation landed — first strip paint 542 ms (≤ 1500),
  idle CPU 0.023 % normalised (0.74 % of one core, ≤ 0.3 %), private working set 44.9 MB
  (≤ 120) with the low memory target reached at 30 s; the handler is event-driven and adds no
  timer. (A first perf run on the same binary breached the memory budget at 141 MB with the
  normal target held for 90 s and 7 % of one core: cursor activity inside the window bounds
  during the idle window keeps the 60 Hz poll and the normal target alive by design. The
  driver now restores the cursor position it found at start.)

## Observations

- **OLE does re-target after the click-through flag flips.** The notch window is
  `WS_EX_TRANSPARENT` until the hit tester sees the cursor over a published shape (60 Hz poll).
  The drag source's first *enter* arrived 65–80 ms after the cursor command that landed in the
  strip — one hit-test tick plus the next mouse move — and *leave* arrived 32 ms after the first
  hop out of the strip while the cursor was still inside the window bounds. So enter and leave
  follow the *shape*, not the window rect: the tiles can rely on `Leave` to spring back, and no
  synthetic "over outside the shape" rule is needed.
- **Coordinates are physical client px of the WebView2 child** (`ScreenToClient` in wry), which
  for the notch window equals the top-level client rect. The UI converts with
  `devicePixelRatio` and hit-tests tiles with `document.elementFromPoint` — the webview receives
  no pointer events during an OLE drag, so the *over* stream is the only way to highlight tiles.
- **Frequency**: OLE calls `DragOver` on mouse moves only (15–20 events during a 600 ms dwell
  with 1 px jitter every 50 ms; a real hand produces far more). The shell forwards *over*
  positions to the UI at most every 16 ms to keep the IPC budget.
- **The window never activates**: WebView2's drop target does not call `SetFocus`, and the
  foreground window stays the drag source throughout. `WS_EX_NOACTIVATE` and `focusable: false`
  hold during drags.
- **wry only accepts `CF_HDROP`** (`enter_is_valid = hdrop.is_some()`): text, URL and
  virtual-file drags (Outlook attachments, some cloud-drive placeholders) produce no events at
  all. Drop actions only need files; the Shelf's "drag text in" (M4-E2) needs either a native
  target for text formats or must stay clipboard-based — recorded as the S2 question.
- **`DoDragDrop` ends at once when no mouse button is down.** Any scripted drag needs a real or
  synthetic button press (`mouse_event(LEFTDOWN)`) landing on the source's own window before
  `DoDragDrop`; the source's `QueryContinueDrag` then owns the lifetime. `SetCursorPos` from a
  third process drives OLE's re-targeting just fine, which is what makes this spike scriptable
  in CI-less environments.
- **Build with the Tauri CLI** (`tauri build --debug --no-bundle`), not `cargo build`: a plain
  debug `cargo build` compiles Tauri's dev configuration and the webview loads `devUrl`, so
  `shell ready` never appears.
