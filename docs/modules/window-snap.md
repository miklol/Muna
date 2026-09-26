# Window snap

**Tier P1 · Owner: `muna-shell-engineer` · Status: implemented (M4-E3; the DWM thumbnail
preview on hover is deferred — see [Implementation notes](#implementation-notes-m4-e3))**

## Reference

`window-snap`: strip of layout glyph tiles; Settings pane "Choose Snap Zones (10/10)" with
tiles Top Left, Bottom Left, Left Half, Maximize, Right Half, Top Right, Bottom Right, thirds.

## Platform

- Detect drag start: `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART/END)`; track cursor; when it
  enters the top hot zone (strip ± 24 px) show tiles; on `MOVESIZEEND` while a tile is hovered,
  apply.
- Apply: compute target rect from the monitor work area (respect the taskbar and Reserved strip);
  correct for invisible borders (`DWMWA_EXTENDED_FRAME_BOUNDS` vs `GetWindowRect`);
  `ShowWindow(SW_RESTORE)` then `SetWindowPos`. Maximize → `SW_MAXIMIZE`.
- Coexists with Windows Snap Layouts / FancyZones: Muna only acts when a tile is hovered.

## Zones

Built-ins as above + custom grid zones (rows × cols, gaps). Up to 10 enabled, ≥ 1. Optional
richer previews (window thumbnail via DWM thumbnails — `DwmRegisterThumbnail`) on hover.

## Acceptance criteria

- Chrome dragged to *Left Half* → occupies exactly the left half of the work area, no 7 px gaps.
- Zones never appear when Snap module is disabled; strip yields to Peek instead.

## Implementation notes (M4-E3)

The drag is the shell's, the zones and the placement are the module's, the tiles are the
UI's. Pieces, in the order a snap flows:

- **Detection** ([spikes/m4-snap](../spikes/m4-snap.md), *go*): the M1 message-pump thread's
  `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART / END)` now carries the dragged window's handle
  (`MoveSizeChanged { started, window }`); the hook path holds an event in under a
  millisecond, and `MOVESIZESTART` lands 20–50 ms after the first movement past the drag
  rectangle, long before the window nears the top edge. `shell::manager::on_move_size` starts
  a **snap session** (`muna_core::snap::SnapSessions`, one at a time, the handle stays in
  Rust) when the module is on, the window is not one of Muna's and
  `WindowPlacement::is_snappable` holds — a visible top-level window with a caption or a
  sizing frame, neither a tool window nor `WS_EX_NOACTIVATE`. The shell raises the cursor
  poll to *active* for the drag and reports the sample as `SnapDragMoved { label, session,
  position }` to the notch window under the cursor (CSS px of that window) and
  `SnapDragLeft` when it leaves it; both only on change. On `MOVESIZEEND` the session is
  marked ended and `SnapDragEnded { session, label }` is broadcast with the window under the
  cursor, or removed at once when the drag ended over no notch window (nobody would cancel
  it).
- **Yield**: a live snap session holds the strip in place — `moving && snapping` yields
  nothing instead of Peek — so the zones have a strip to grow out of; Park still wins
  (`tests/shell_model.rs`). With the module in `shell.disabledModules` no session starts and
  the drag peeks the strip as before.
- **Shell (UI)**: the machine gains the `snap` state with a `snapIntent` timer
  (`timings.snapZonesDelayMs`, 120 ms) and the events `snapNear`, `snapFar`, `snapEnd`. The
  notch window tests each `SnapDragMoved` position against the strip's *rest* box padded by
  `timings.snapHotZonePx` (24 px) — and, while the zones show, their rest box too — so the
  hot zone never flickers mid-morph and a narrow row never shrinks the zone under the
  cursor. Near for 120 ms morphs any strip form (collapsed, peek, hover reveal) into the
  zones with `expand` and the panel material; the zones never interrupt an open panel or the
  drop row. Far, the drag ending elsewhere, Esc and Park close them; the pointer and panel
  controls are ignored while they show. A drag that ends over this window with the zones
  closed, or with the module gone, is cancelled once (`snap_cancel`); one that ends over
  another window is simply forgotten here. The zones are the module surface
  `ModuleDefinition.snap` (`snapModuleOf` in the registry), animated with `snapZoneRecipe` on
  `toggle` after the content-enter delay.
- **Tiles** (`modules/window-snap/zones.ts`, `snap-surface.tsx`): one row of equal glyph
  tiles — the screen outline with the zone filled (`ZoneGlyph`) and its name — for the
  enabled built-ins in strip order, then the grid's cells row by row (`Cell 2, 3`); ten at
  most by construction of the settings. The row lays out at its own width inside
  `minmax(0, 1fr)` tracks, so it shrinks evenly when the panel is narrower. A window drag
  holds the cursor, so `:hover` never fires: the tile under each position is found by
  measuring the tiles' boxes, and it tints `--surface-3` with `toggle`. When the drag `ended`
  over this window the hovered tile is applied — `snap_apply(session, label, zone)` with
  `SnapZoneRef = { builtIn } | { cell: { row, col } }` — or the session cancelled, exactly
  once, and the notch is handed back.
- **Zones and placement** (`src-tauri/src/modules/window_snap`, Tauri-free
  `WindowSnapService`): `zones.rs` resolves a zone on the monitor the hovered notch window
  belongs to — halves, quarters and thirds of the *work area* in physical px, so the taskbar
  and a Reserved strip are honoured, the grid's cells inside gutters of `gap` CSS px scaled
  to the monitor's DPI (one gutter before each cell and one after the last) — re-reading the
  work area at apply time. `muna_platform::WindowPlacement`
  (`windows/placement.rs`) places by `DWMWA_EXTENDED_FRAME_BOUNDS`: the visible frame is
  measured, the invisible sizing border (`GetWindowRect` minus the frame, about 7 px at
  100 %) is added back, `ShowWindowAsync(SW_RESTORE)` precedes `SetWindowPos` with
  `SWP_ASYNCWINDOWPOS | SWP_NOACTIVATE | SWP_NOZORDER`; *Maximize* is
  `ShowWindowAsync(SW_MAXIMIZE)` after a move onto the target monitor. Every call posts to
  the target, so a hung application never holds a Muna thread; `snap_apply` runs on a
  blocking thread because 120 ms after the placement the frame is re-read and, if any edge
  is off by more than 2 px — Aero Snap maximised the window as the drag ended, or a
  per-monitor-DPI window resized itself crossing monitors — it is placed once more. Refusals
  are typed: `snap.unknownSession`, `snap.zoneNotOffered` (the settings changed under the
  drag), `snap.unknownMonitor`, and the platform's `AccessDenied` for an elevated window.
- **Settings pane**: a toggle per built-in zone (the last one stays on while there is no
  grid), *Zones in use* `n of 10`, and *Show a grid* with rows 1–4, columns 1–4 and a gap
  slider 0–32 px in steps of two; the grid's cells count towards the ten, so switching it on
  trims the zones from the end. Namespace `settings.modules["window-snap"] = { zones:
  SnapZone[], grid: { rows, cols, gap } | null }`, normalised the same way in Rust and in
  `normaliseWindowSnapSettings` (duplicates dropped, no zones and no grid reads as the
  defaults, zones trimmed to what the grid leaves).
- **Deviations from the spec above**: the contract is `SnapDragMoved` / `SnapDragLeft` /
  `SnapDragEnded` plus `snap_apply(session, label, zone)` and `snap_cancel(session)` rather
  than the build plan's `SnapDragChanged { hwnd, cursor }` and `snap_apply(zone)` — the UI
  names a session, never a window handle, and each notch window gets its own positions; the
  DWM thumbnail preview on hover did not ship (the glyph tiles are the reference's, and a
  live thumbnail needs `DwmRegisterThumbnail` on a window the notch cannot own without
  activating); `ShowWindow` is `ShowWindowAsync` (see *placement*); coexistence with Snap
  Layouts is by construction — Muna only acts on a release over a tile — and a hovered
  Windows layout flyout is not detected. Hardware rows in the
  [checklist](../qa/checklists/window-snap.md).
- **Tests**: `tests/window_snap.rs` (zone geometry on one monitor and a 150 % secondary,
  gutters and DPI, `SnapZoneRef` serde, settings normalisation and round-trip, the module
  switch, placement on the primary and a secondary, the work-area re-read, an unknown
  monitor falling back to the primary, a zone the settings no longer offer, unknown and
  cancelled sessions, the stuck-window second `place`, `AccessDenied` passthrough, session
  replacement), `tests/shell_model.rs` (a snap drag holds the strip and loses to a park), the
  S3 timing test next to the pump (`platform-tests`), contract schema round-trips, Vitest for
  the machine's `snap` state, the geometry, the store, the zones, the surface (tiles from the
  settings, the hovered tile, apply and cancel once), the pane and five notch-window
  scenarios; Storybook stories for the zones and the pane.
