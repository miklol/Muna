# QA checklist · Shelf

Covers the M4 exit criterion "Shelf drag-out lands files in Explorer, Chrome upload, Teams" and
the acceptance criteria of docs/modules/shelf.md. The gesture-to-OLE latency and the Explorer
and browser targets are measured by the scripted spike (`node scripts/spikes/drag/index.mjs`,
[spikes/m4-drag](../../spikes/m4-drag.md)) and every command by `tests/shelf.rs` against the
fake platform; this checklist is the application, storage and visual side.

## Running it

1. Start Muna (`scripts\dev.ps1`) with the Shelf module on and *Copy files into Shelf storage*
   off (the default). Have a scratch folder with a picture, a PDF, a folder and a file on a USB
   stick; open Outlook (a new message), Teams (a chat) and a browser on a page with a file
   input.
2. Fill the Shelf from Explorer through the *Shelf* drop tile (rows 1–3), then drive the panel
   (rows 4–13), the targets (rows 14–19), storage (rows 20–23) and settings (rows 24–27).
3. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Drop three files on the *Shelf* tile | an *Added 3 items to the Shelf* notice; the panel shows the three newest first with Explorer's thumbnails for the picture and the PDF, the extension for the rest; the strip never takes focus |
| 2 | Drop the same files again | nothing new: the count is unchanged and no duplicate tile |
| 3 | Drop a folder | a tile with the folder glyph and *Folder*; no size in the tooltip |
| 4 | Paste a sentence and a URL in the panel field, Enter each | two snippet tiles named after the first line; the link shows the link glyph; the tooltip is the first 240 characters |
| 5 | Click a tile, Ctrl-click another | both selected; the status reads *2 of N selected*; the toolbar's *Copy* and trash count two |
| 6 | Keyboard only: Tab into the grid, arrows, Home, End, Space, Ctrl+A, Esc | the focus ring moves by row and column; Space toggles, Ctrl+A selects everything, Esc clears; the status follows |
| 7 | Double-click a file, Enter on a focused file | the file opens in its default app; the notch does not become the foreground window |
| 8 | *Show in Explorer* with two files selected | one Explorer window with both selected |
| 9 | *Copy* with a picture and a PDF selected, Ctrl+V in an Explorer folder | both files are pasted; *Copied to the clipboard* shows in the status for about 1.5 s |
| 10 | *Copy* with one snippet selected, Ctrl+V in Notepad | the text is pasted whole (beyond the preview) |
| 11 | Delete key on a selected tile; the trash with nothing selected | the tile leaves on the spring; *Clear the Shelf* empties the grid and shows the dashed empty state |
| 12 | Rename or delete a parked file in Explorer, re-open the panel | the tile keeps its name with the unlinked glyph and *File not found*; *Remove N missing* appears and removes only those |
| 13 | Quit Muna, start it again | every item is back in the same order; thumbnails reload |
| 14 | Drag a tile into an Explorer folder | Explorer's copy cursor over the list; the file is in the folder; the tile stays on the Shelf |
| 15 | Select two tiles, drag one of them into Explorer | both files land; dragging an unselected tile carries only itself |
| 16 | Drag a tile into a browser's file input (Chrome and Edge) | the input names the file; no HTML5 drag ghost from the webview |
| 17 | Drag a tile into an Outlook message | the file is attached |
| 18 | Drag a tile into a Teams chat | the file is attached or uploaded |
| 19 | Start a drag and release back over the strip | nothing is re-added; the count is unchanged; the panel still responds |
| 20 | *Copy files into Shelf storage* on, drop a file, delete the original | the tile stays whole (tooltip *Copy in Shelf storage*); `%LOCALAPPDATA%\Muna\shelf` holds one folder per item |
| 21 | Remove that item | its folder under `shelf\` is gone; the original's location is untouched |
| 22 | *Copy files into Shelf storage* on, drop a file from a read-only or disconnected location | a *Could not add to the Shelf* notice; nothing is parked; no stray folder |
| 23 | Drop a large file (≥ 1 GB) with copies on | the copy finishes without the notch freezing; the tile appears when it is done |
| 24 | *Remove items after* 1 day, then set the PC clock a day ahead and wait an hour (or restart) | the items are gone; the snapshot count in Settings follows |
| 25 | Settings → Shelf → *Clear* | the grid empties; copies are deleted; original files are untouched |
| 26 | Turn the Shelf module off in Settings → Modules, drag files over the strip | the *Shelf* tile is dimmed; releasing on it parks nothing and shows no notice (like a dimmed *Unzip*) |
| 27 | Reduced motion (Windows *Animation effects* off) | tiles appear and leave without the spring; selection and copy notices still show |
| 28 | Two monitors | the panel and drag-out work from either strip |
| 29 | Windows 10 22H2 | rows 1, 9, 14, 16 and 17 |

## Results

Recorded per run; the first pass is in the M4-E2 PR description.
