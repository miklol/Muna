# Drop Actions

**Tier P1 · Owner: `muna-shell-engineer` + `muna-ui-engineer` · Status: implemented (M4-E1;
the Shelf, Convert and Music tiles wait for their modules — see
[Implementation notes](#implementation-notes-m4-e1))**

## Reference

`demo-23` (preview in Settings): equal tiles separated by hairlines — outline icon, title,
subtitle; disabled tiles dimmed; *Expand* tile reveals a second row on hover.

## Tiles (Windows mapping)

| Tile | Action |
| ------ | -------- |
| Shelf | stash in Shelf module (M4-E2) |
| Nearby Share | `DataTransferManager.ShowShareUI` with `StorageItems` (Windows Nearby sharing) |
| Cloud | copy/move to a configured folder (OneDrive, Google Drive, Dropbox, custom) |
| Open with | pick from configured apps (`ShellExecuteEx` with verb) |
| Convert | image → PNG/JPEG/WebP/HEIC via `image` crate / WIC; PDF→PNG later (deferred) |
| Zip / Unzip | `zip` crate, streaming, progress notice |
| Move to / Copy to | `IFileOperation` (shows conflict dialogs, supports undo) |
| Music | enqueue in default player (`ShellExecute` on files) (deferred) |
| Trash / Eject | `IFileOperation` with `FOF_ALLOWUNDO` → Recycle Bin; removable volumes → `CM_Request_Device_EjectW` |
| Expand | second row |
| Divider / Folder | layout helpers |

## Behaviour

- Detect OLE drag entering the top hot zone (Tauri's drag-drop path on the notch window — wry's
  `IDropTarget`; no target of our own, see [spikes/m4-drop](../spikes/m4-drop.md). The WebView
  receives no pointer events during an OLE drag, so the *over* stream drives the highlight.)
  Panel morphs into tiles; hover a tile → highlight; drop → run action → progress/result notice;
  Esc cancels.
- "Expand Notch" setting unlocks > 4 tiles per row.
- Order, folders, dividers, width in Settings.

## Acceptance criteria

- Dragging files from Explorer over the strip shows tiles within 120 ms; releasing outside
  cancels with a spring-back.
- Nearby Share tile opens the share sheet with all dropped items.
- Trash respects the Recycle Bin (undo via Explorer works).

## Implementation notes (M4-E1)

The drag is the shell's, the paths are Rust's, the tiles are the module's. Pieces, in the order
a drop flows:

- **Detection** ([spikes/m4-drop](../spikes/m4-drop.md), *go*): Tauri's own drag-drop path
  (`dragDropEnabled: true` → wry's `IDropTarget` on the WebView2 child) reports *enter*, *over*
  and *leave* on the transparent, non-activating notch window 32–80 ms after the cursor crosses
  the strip's shape, so the shell registers no target of its own. `shell::manager` handles
  `WindowEvent::DragDrop`; `shell/drag.rs` summarises each drag for one log line (counts and
  coordinates, never paths) and coalesces *over* to one `DropMoved` per 16 ms frame. wry only
  accepts `CF_HDROP`: text and virtual-file drags (Outlook attachments, some cloud placeholders)
  produce no events, which is the Shelf's S2 question.
- **Sessions** (`muna_core::drops::DropSessions`): the paths of every live drag stay in Rust
  from *enter* until an action runs or the UI cancels; one session per window label, so the
  registry is bounded by the number of notch windows. The UI receives a session id and
  `DropItem { name, kind }` only (no paths, no sizes) through `DropEntered { session, label,
  items, position }`, `DropMoved`, `Dropped` and `DropLeft`.
- **Shell**: a file drag over a window sets `YieldInputs.dragging`, which wins over Peek and
  loses to Park (`tests/shell_model.rs`). The UI machine gains the `drop` state (`dropEnter` /
  `dropLeave`; every other event is ignored while it holds), the row replaces whatever was
  showing — strip, hover reveal or an open panel — with `expand`, and leaves when the drag
  does. The row is rendered by the module that publishes `ModuleDefinition.drop`
  (`dropModuleOf` in the registry); while the module is disabled or the window parked, or when
  Esc closes the row under a drag that already dropped, the shell cancels the session once
  (`forgetDrop`) so Rust forgets the paths.
- **Tiles** (`modules/drop-actions/tiles.ts`, `drop-surface.tsx`): the row is
  `settings.modules["drop-actions"].tiles` in order — the nine built-ins (Nearby Share, Copy to,
  Move to, Open with, Zip, Unzip, Show in Explorer, Recycle Bin, Eject), one tile per configured
  folder (*Copy here* / *Move here*), dividers as gaps — four per row, eight with *Expand
  notch*; a *More* tile stands in for the overflow and reveals the second row on hover. Tiles
  enter with the 30 ms stagger (`staggerDelayS`, `tileStaggerRecipe` in `@muna/ui/motion`),
  the hovered tile grows 1.04 on `toggle` and tints `--surface-3`, the landing tile pulses on
  `notice`. The WebView gets no pointer events during an OLE drag, so `:hover` never fires:
  the tile under each `DropMoved` position is found by measuring the tiles' boxes on every move;
  *Unzip* is dimmed (`aria-disabled`) when nothing dragged is an archive.
- **Actions** (`src-tauri/src/modules/drop_actions`, Tauri-free `DropActionsService`):
  `drop_run(session, action)` takes the session's paths and blocks on a blocking thread for as
  long as the shell's own dialogs are up. `muna_platform::FileOps` does the work — copy / move
  (`IFileOperation` with `FOF_ALLOWUNDO | FOF_NOCONFIRMMKDIR`, so conflicts, progress and Undo
  are Explorer's), recycle (`FOFX_RECYCLEONDELETE | FOF_ALLOWUNDO`, no confirmation of our own:
  Explorer's Undo brings the items back), *Open with* (`ShellExecuteExW` `openas` with
  `SEE_MASK_INVOKEIDLIST | SEE_MASK_NOASYNC`), reveal (`SHOpenFolderAndSelectItems`), share
  (`IDataTransferManagerInterop::GetForWindow` → `DataRequested` with `SetStorageItemsReadOnly`
  → `ShowShareUIForWindow`, hopped to the notch window's thread through `WindowThread`), eject
  (`GetDriveTypeW` removable check, `IOCTL_STORAGE_GET_DEVICE_NUMBER` → the disk's devnode →
  `CM_Get_Parent` → `CM_Request_Device_EjectW`), and the *Copy to* / *Move to* folder picker
  (`IFileOpenDialog` with `FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM`). Each shell operation runs
  on a short-lived STA thread of its own so two drops never queue. Zip and unzip are
  `archive.rs` over the `zip` crate: streamed through a 64 KiB buffer, whole-percent progress,
  cancel at the next buffer, names relative to the item's parent, ZIP64 past 4 GiB, `Archive.zip`
  for several items, and extraction refuses entries that would escape the destination.
- **Progress and results**: copy, move, zip and unzip publish a `drop-actions:job-<id>` strip
  activity once their work is under way (after the picker, never while a dialog is up); zip and
  unzip carry a percentage. A finished job publishes a notice (`dropActions.job.*`), a failure
  one that says what to do (`notFound`, `unsupported`, `noArchive`, `failed`); a cancelled
  dialog publishes nothing. The snapshot keeps the last eight jobs for the pane's *In progress*
  list and `drop_cancel_job` stops a running archive.
- **Settings pane**: *Show actions when files are dragged over the notch* (the module's own
  `shell.disabledModules` toggle, so a drag leaves the notch alone when off), *Expand notch*,
  the tile list in order with *Show*, *Move up* / *Move down* and *Remove*, *Add a divider*,
  folders (up to eight; *Choose…* opens the unowned picker through `drop_pick_folder`; copy or
  move per folder), and the in-progress list. Namespace `settings.modules["drop-actions"] =
  { tiles, folders: [{ id, name, path, mode }], expandNotch }`; folder paths are content and
  never reach a log line.
- **Deviations from the spec above**: no `IDropTarget` of our own (the spike made it
  unnecessary); *Shelf*, *Convert* and *Music* tiles wait for their modules; *Open with* opens
  the system dialog rather than a configured app list; the pickers are unowned dialogs (the
  notch window cannot own a modal without activating); the row has no keyboard equivalent —
  a drag is pointer-only by nature, Esc cancels; the share sheet's anchoring to the notch
  window is unverified on hardware ([checklist](../qa/checklists/drop-actions.md)).
- **Tests**: `tests/drop_actions.rs` (fake `FileOps` scripted per call: every action, folder
  tiles, the picker's title and dismissal, unzip with no archive, cancellation mid-way, a
  missing item, the snapshot's job list, settings repair and the folder cap; zip and unzip on a
  temp folder, including escaping entries), `tests/shell_model.rs` (a file drag holds the strip
  in place and loses to a park), contract schema round-trips, Vitest for the tile layout, the
  row (hover, reveal, dimmed unzip, reduced motion), the pane, the machine's `drop` state and
  the notch window's five drop scenarios; Storybook stories for the row and the pane under
  `apps/desktop`, each waiting for the stagger to settle before axe runs (`UnzipDimmed` opts
  out of `color-contrast`: a dimmed `aria-disabled` tile is not a control axe skips).
