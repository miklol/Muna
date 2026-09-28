# Shelf

**Tier P1 · Owner: `muna-shell-engineer` + `muna-ui-engineer` · Status: implemented (M4-E2;
see [Implementation notes](#implementation-notes-m4-e2))**

## Reference

`shelf`, `shelf-feature-2`, `demo-03`. Dashed drop zone; grid of 64 px thumbnails with names;
header: `N items`, select-all/clear circles, `Copy ⇄`, trash, collapse, info.

## Behaviour

- Items are references (paths) + optional copies (setting: *Copy files into Shelf storage*).
- Drag **out** to any app: Rust-side `DoDragDrop` with `CF_HDROP` data object started when
  the UI reports a drag gesture beyond 6 px (`tauri-plugin-drag`-style). Validated by
  [spike S2](../spikes/m4-drag.md): the gesture reaches OLE ≈ 40 ms after the threshold and
  lands in Explorer and browser file inputs; the row opts out of the webview's own HTML5 drag.
- While a drag out of the notch is in flight the shell ignores its own inbound drag events, so
  a release back over the notch — a drop onto our own drop target — is ignored instead of
  re-adding the item (an in-process flag rather than a private clipboard format, see the
  implementation notes).
- Thumbnails via `IShellItemImageFactory` (Explorer's own thumbnails); text/URL snippets
  supported as items (`CF_UNICODETEXT`).
- Multi-select, Copy (puts `CF_HDROP` on the clipboard), Remove, Reveal in Explorer,
  Clear all; persists across restarts.

## Acceptance criteria

- Drag a Shelf item into Outlook/Teams → attaches the file.
- Missing files show a broken-link state and can be removed in bulk.

## Implementation notes (M4-E2)

Items live in Rust, the panel sees ids. Pieces, in the order an item flows:

- **Sources**: the Drop actions *Shelf* tile — `DropAction::Shelf` hands the session's paths
  to `muna_core::ShelfIntake`, the one seam between the two Rust modules (the drop-actions
  service holds an `Arc<dyn ShelfIntake>` the shell wires at start; the UI halves never import
  each other) — and the panel's paste field, which parks text and links as snippets
  (`ShelfCommand::AddText`, trimmed, cut at 100 000 characters). The tile is dimmed and the
  intake answers `Disabled` while the module is in `shell.disabledModules`. Clipboard history
  as a source did not ship (see deviations).
- **Storage** (`muna_core::shelf`, migration 4): `shelf_items (id, kind, name, path, text,
  size, copied, added_at, sort_order)`; the same path is never parked twice (a second drop of
  a parked file counts as nothing new), snippets are named after their first line. With *Copy
  files into Shelf storage* on, each file is copied through `FileOps::transfer` into its own
  folder under `%LOCALAPPDATA%\Muna\shelf\<hex time>-<n>\` first and the copy is the item;
  removing the item deletes that folder (and only a folder directly inside Shelf storage).
  Items expire by the `expiryDays` setting (0 = never, at most 365) through an hourly sweep on
  the module backend, once at start.
- **Snapshot** (`get_shelf_snapshot`, `ShelfChanged { snapshot }` after every change): each
  `ShelfItem` carries `id`, `kind` (`file` | `text`), `name`, `extension`, `size` (files only,
  never a folder's), `isFolder`, `copied`, `missing` (the referenced path no longer exists —
  the broken-link state), `preview` (the first 240 characters of a snippet) and `addedAtMs`.
  No path and no full text ever crosses IPC; the panel shows names, the settings pane a count.
- **Commands** (`shelf_command`, replies with the snapshot after it): `addText`, `remove
  { ids }`, `removeMissing`, `clear`, `open { id }` (the default handler), `reveal { ids }`
  (Explorer with the files selected), `copy { ids }` — every present file as `CF_HDROP`
  through `DragSource::place_on_clipboard` (`OleSetClipboard` + `OleFlushClipboard`, so the
  data outlives the object), or the text of a lone snippet as `CF_UNICODETEXT`. Errors are
  `shelf.emptyText`, `shelf.unknownItem`, `shelf.nothingToCarry` (only missing files or
  nothing draggable) and `shelf.noStorage` (copies on, no profile folder).
- **Drag out**: the panel's tiles are drag handles through the shell's `useDragOut` with a
  `{ kind: 'shelf', ids }` request; dragging a selected tile carries the whole selection, an
  unselected one only itself. Rust resolves the ids (`ShelfService::payload`: present files as
  `CF_HDROP`, or the joined text of snippets when no file is present — missing files are
  skipped) and runs `SHDoDragDrop` on the main thread with the shell's own data object
  ([spike S2](../spikes/m4-drag.md)). While it runs, `DropSessions::self_drag()` marks the drag
  as ours and `shell::manager::on_drag_drop` drops every inbound *enter / over / drop / leave*
  until the guard is released, so a release back over the strip re-adds nothing — the
  alternative recorded in S2, a private clipboard format the inbound target inspects, would
  need a data object of our own for the file case (the shell's carries the id lists) and
  buys nothing the flag does not.
- **Thumbnails** (`shelf_thumbnail(id)` → PNG data URL or `null`):
  `IShellItemImageFactory::GetImage` at 128 device px (`SIIGBF_RESIZETOFIT |
  SIIGBF_BIGGERSIZEOK`, Explorer's cached thumbnails for pictures, documents and videos, the
  file-type icon otherwise), read back through `GetDIBits` as BGRA and encoded with `image`.
  Cached per item for the life of the process; the panel asks once per file item through
  TanStack Query and shows the extension in a placeholder tile until it arrives or when there
  is none.
- **Panel** (`apps/desktop/src/modules/shelf`): a toolbar with the paste field, select all /
  clear selection, *Copy* (the selection, or everything present) and the trash (the selection,
  or *Clear* when nothing is selected); a status line (*N items · N selected*, *Copied to the
  clipboard* for 1.5 s, and *Show in Explorer* / *Remove N missing* when they apply); the
  grid as a `listbox` with `aria-multiselectable` — newest first, click toggles, double-click
  opens, arrow keys move by the measured column count, Home / End, Space toggles, Enter opens,
  Delete removes, Ctrl+A selects all, Esc clears — tiles enter and leave through
  `AnimatePresence` on the `layout` spring and sit still under reduced motion. Missing files
  keep their name with an unlinked glyph and *File not found*; the empty state is the dashed
  zone with *Nothing on the Shelf yet* and how to fill it.
- **Height budget**: the grid scrolls inside 212 px — two rows of tiles — under the toolbar
  and the status line, so the panel never asks the shell for more than 360 px.
- **Settings pane**: *Copy files into Shelf storage*, *Remove items after* (never, 1, 7 or 30
  days; a hand-edited value shows as *N days*), the item count and a destructive *Clear the
  Shelf*. Namespace `settings.modules.shelf = { copyIntoStorage, expiryDays }`, validated on
  both sides (`ShelfSettings::from_document` clamps, the zod schema clamps identically).
- **Deviations from the plan**: no clipboard-history source (`Clipboard.HistoryChanged`) —
  it would turn every copy into an item and belongs behind an opt-in toggle the spec does not
  have yet; images are files (a pasted bitmap is not parked); no collapse or info buttons in
  the header — the panel's chrome is the shell's; the self-drop guard is the in-flight flag
  above rather than the `MunaShelfDrag` format S2 suggested; `tauri-plugin-drag` was not used
  (the shell has its own `DragSource` since S2).
- **Tests**: `tests/shelf.rs` (registration, settings, the intake and its `Disabled` answer,
  snapshots without paths or full text, remove / clear / remove missing, open / reveal / copy
  through the fake platform, drag payloads that skip missing files and join snippets,
  thumbnails fetched once, storage copies and their clean-up, a refused copy, no profile,
  expiry), `muna_core::drops` (the self-drag guard), `muna_core::shelf` (the store),
  contract schema round-trips, Vitest for the panel (ordering, selection, keyboard, drag ids,
  copy notice, missing files, the empty state) and the pane; Storybook stories for both under
  `apps/desktop`. Hardware and application rows in
  [qa/checklists/shelf](../qa/checklists/shelf.md).
