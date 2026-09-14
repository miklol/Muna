# Drop Actions

**Tier P1 · Owner: `muna-shell-engineer` + `muna-ui-engineer` · Status: spec**

## Reference

`demo-23` (preview in Settings): equal tiles separated by hairlines — outline icon, title,
subtitle; disabled tiles dimmed; *Expand* tile reveals a second row on hover.

## Tiles (Windows mapping)

| Tile | Action |
|------|--------|
| Shelf | stash in Shelf module |
| Nearby Share | `DataTransferManager.ShowShareUI` with `StorageItems` (Windows Nearby sharing) |
| Cloud | copy/move to a configured folder (OneDrive, Google Drive, Dropbox, custom) |
| Open with | pick from configured apps (`ShellExecuteEx` with verb) |
| Convert | image → PNG/JPEG/WebP/HEIC via `image` crate / WIC; PDF→PNG later |
| Zip / Unzip | `zip` crate, streaming, progress notice |
| Move to / Copy to | `IFileOperation` (shows conflict dialogs, supports undo) |
| Music | enqueue in default player (`ShellExecute` on files) |
| Trash / Eject | `IFileOperation` with `FOF_ALLOWUNDO` → Recycle Bin; removable volumes → `CM_Request_Device_EjectW` |
| Expand | second row |
| Divider / Folder | layout helpers |

## Behaviour

- Detect OLE drag entering the top hot zone (Rust `IDropTarget` on the notch window; the
  WebView also receives HTML5 drag events for the visual). Panel morphs into tiles; hover a
  tile → highlight; drop → run action → progress/result notice; Esc cancels.
- "Expand Notch" setting unlocks > 4 tiles per row.
- Order, folders, dividers, width in Settings.

## Acceptance criteria

- Dragging files from Explorer over the strip shows tiles within 120 ms; releasing outside
  cancels with a spring-back.
- Nearby Share tile opens the share sheet with all dropped items.
- Trash respects the Recycle Bin (undo via Explorer works).
