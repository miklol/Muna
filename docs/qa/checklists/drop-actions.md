# QA checklist · Drop actions

Covers the M4 exit criterion "Drop → tile → action round-trips on Explorer, browsers, Outlook
attachments" and the acceptance criteria of docs/modules/drop-actions.md. Enter / over / leave
timing is measured by the scripted spike (`node scripts/spikes/drop/index.mjs`,
[spikes/m4-drop](../../spikes/m4-drop.md)) and every action by `tests/drop_actions.rs` against
the fake platform; this checklist is the hardware, application and visual side.

## Running it

1. Start Muna (`scripts\dev.ps1`) with *Show actions when files are dragged over the notch* on
   (the default) and a scratch folder with a few files, a folder, a `.zip` and a large file
   (≥ 1 GB) for the progress rows.
2. Drag from each source in the table over the strip; release on the tile named, or outside
   the tiles for the cancel rows.
3. For the Eject row plug in a USB stick and drag a file that lives on it.
4. Paste the table below with the build and date.

## Scenarios

| # | Scenario | Expect |
| --- | ---------- | -------- |
| 1 | Drag files from Explorer over the strip | the tile row is showing within 120 ms of the cursor reaching the strip; tiles stagger in; the strip never takes focus (Explorer keeps the selection highlight) |
| 2 | Move across the tiles | the tile under the cursor grows and tints; nothing else reacts; the panel does not open |
| 3 | Release outside the tiles, or drag away | the row springs back to the strip; nothing runs; no notice |
| 4 | Esc during the drag | Explorer cancels the drag; the row collapses |
| 5 | Copy to → pick a folder | Explorer's copy dialog for large sets; *Copying N items* in the strip once the picker closes; a *Copied* notice; the files are in the folder |
| 6 | Move to, then Ctrl+Z in Explorer | the files move; Explorer's Undo brings them back |
| 7 | Copy to → close the picker | nothing runs, no notice, the row is gone |
| 8 | Folder tile (copy) and folder tile (move) | the files land in the configured folder with the configured mode; the tile shows the folder's name |
| 9 | Zip 3 files, then the ≥ 1 GB file | `Archive.zip` beside the first item; a single file is named after itself; the strip shows the percentage for the large file |
| 10 | Cancel the large zip from Settings → Drop actions → In progress | the partial archive is removed; no *failed* notice |
| 11 | Unzip a `.zip` | a folder named after the archive beside it; a second unzip of the same archive never overwrites |
| 12 | Drag a file that is not an archive | the *Unzip* tile is dimmed; releasing on it does nothing |
| 13 | Nearby Share | the Windows share sheet opens with every dropped item listed; nearby devices appear when Nearby sharing is on |
| 14 | Open with | the Windows *Open with* dialog for the first item |
| 15 | Show in Explorer | an Explorer window with the items selected |
| 16 | Recycle Bin | the items are in the Recycle Bin without a confirmation; *Restore* in the bin brings them back |
| 17 | Eject with a file from a USB stick | Windows reports "Safe to remove hardware"; the same tile on a fixed drive shows the *can't do that* notice |
| 18 | *Expand notch* on | eight tiles per row; the *More* tile disappears when everything fits |
| 19 | *More* tile | hovering it reveals the second row; tiles there work like the first |
| 20 | Drag from Chrome (download bar or a web page image) | the row shows for real files; a URL or text drag leaves the notch alone |
| 21 | Drag an Outlook attachment | Outlook offers a virtual file: the notch does not react (wry accepts `CF_HDROP` only; recorded as the Shelf's S2 question) |
| 22 | Drag while a fullscreen app holds the notch parked | nothing shows; Explorer completes its own drag |
| 23 | Two monitors | the row shows on the strip the cursor is over; the other strip is untouched |
| 24 | *Show actions when files are dragged over the notch* off | a drag over the strip changes nothing |
| 25 | Reduced motion (Windows *Animation effects* off) | tiles appear without the stagger; the highlight is a tint only |
| 26 | Windows 10 22H2 | rows 1, 5, 13 and 16 |

## Results

Recorded per run; the first pass is in the M4-E1 PR description.
