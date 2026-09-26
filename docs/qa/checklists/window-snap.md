# QA checklist · Window snap

Covers the M4 exit criterion "a dragged window snaps into a zone with no gaps on mixed DPI" and
the acceptance criteria of docs/modules/window-snap.md. The hook path, the drag-start timing
and the pump's shutdown are measured by the scripted spike (`cargo test -p muna-platform --lib
--features platform-tests -- s3_a --nocapture`, [spikes/m4-snap](../../spikes/m4-snap.md)) and
the zone arithmetic, the placement calls and every refusal by `tests/window_snap.rs` against
the fake platform; this checklist is the application, monitor and visual side.

## Running it

1. Start Muna (`scripts\dev.ps1`) with the Window snap module on and every zone enabled (the
   default). Have Chrome or Edge, Notepad, Explorer, a UWP app (Calculator), an elevated window
   (an admin Terminal) and, if possible, a second monitor at another scale.
2. Drive the zones (rows 1–9), the windows (rows 10–16), the monitors (rows 17–20) and the
   settings (rows 21–25).
3. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Drag Chrome by its title bar towards the notch; stop with the cursor 20 px under the strip | after about 120 ms the strip morphs into the row of zone glyphs with the panel material; the strip never peeks or takes focus |
| 2 | Keep dragging left and right along the row | the tile under the cursor tints; between tiles nothing is tinted; the row does not move |
| 3 | Drag straight down, well past the row | the row collapses back to the strip on the spring; nothing else changes |
| 4 | Drag across the strip at speed and away again without stopping | no row (the 120 ms intent delay filters the crossing) |
| 5 | Release over *Left half* | Chrome occupies exactly the left half of the work area: flush with the left edge, the top and the taskbar, no 7 px gap on any side, the right edge on the centre line |
| 6 | Release over *Maximize* | Chrome maximises on that monitor (its caption buttons show the restore glyph) |
| 7 | Release over *Top right* then drag it again to *Bottom right* | quarters tile exactly; the second release restores the size and moves in one motion |
| 8 | Release over the row but between two tiles | nothing moves; the row collapses; no notice |
| 9 | Show the row, press Esc, keep dragging and release under the strip | the row closes on Esc; the release places nothing; the next drag shows the row again |
| 10 | Drag a window that Windows has maximised (Aero Snap to the top edge) and release over *Left half* | the window is restored and placed once, without a visible bounce |
| 11 | Drag a Win32 app with a thick frame but no caption (a borderless game launcher) | the row shows and the placement is exact |
| 12 | Drag Calculator (UWP) | the row shows; releasing places the frame host exactly |
| 13 | Drag an elevated window (admin Terminal) and release over a zone | the row shows; the window does not move; nothing crashes; the log has one *AccessDenied* line and no title |
| 14 | Drag a tool window (a floating palette, Muna's own settings window) | no row: the drag peeks the strip as before |
| 15 | Drag a window by a Snap Layouts hover (Windows 11's own zones flyout at the top) and release on a Windows zone | Windows places it; Muna shows its row only while the cursor is in the notch's hot zone and places nothing when the release is elsewhere |
| 16 | Release with the notch window parked (a fullscreen video on that monitor) | no row; the drag ends normally |
| 17 | Two monitors at 100 % and 150 %: drag a window from the 100 % monitor to the 150 % monitor's notch and release over *Right half* | the window fills the right half of the 150 % monitor's work area exactly, after its own DPI resize (the 120 ms verification pass places it once more if it moved) |
| 18 | The reverse: 150 % → 100 % | as row 17, on the 100 % monitor |
| 19 | Taskbar on the left or top of a monitor | the zones honour the work area: nothing sits under the taskbar |
| 20 | Reserved strip mode on one monitor | the zones start under the reserved band |
| 21 | Settings → Window snap: turn off *Maximize* and *Top left* | the row shows eight tiles in strip order; *Zones in use* reads *8 of 10* |
| 22 | Turn on *Show a grid* | rows and columns show at 2 × 2, the gap at 8 px; *Zones in use* reads *10 of 10* and the last four zones went off to make room; the row shows six zones then *Cell 1, 1* … *Cell 2, 2* |
| 23 | Set the grid to 1 × 3 with a 16 px gap and release a window over *Cell 1, 2* | the window fills the middle third of the work area less the gutters: 16 px (scaled by the monitor's DPI) from the top, the taskbar and each neighbouring cell |
| 24 | Turn every zone off but one | the last toggle is disabled and stays on |
| 25 | Turn the Window snap module off in Settings → Modules, drag a window to the notch | no row; the drag peeks the strip; releasing does nothing |
| 26 | Reduced motion (Windows *Animation effects* off) | the row fades in and out without the spring; tinting still follows the cursor |
| 27 | Windows 10 22H2 | rows 1, 5, 6, 10 and 17 |

## Results

Recorded per run; the first pass is in the M4-E3 PR description.
