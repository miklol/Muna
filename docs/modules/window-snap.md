# Window snap

**Tier P1 · Owner: `muna-shell-engineer` · Status: spec**

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
