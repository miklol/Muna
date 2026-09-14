# M4 · Power tools

Read `docs/07-roadmap.md#m4--power-tools-4-weeks`. Requires M3 merged. Use the generic module
prompt from [m3-daily-modules.md](m3-daily-modules.md#generic-module-prompt) with these notes.

- **M4-E1 Drop actions** (`muna-shell-engineer` + `muna-module-developer`) — Tauri
  `onDragDropEvent` (native OLE; HTML5 DnD stays off), drop tiles morph per
  docs/06-motion-spec.md; actions via `IFileOperation` (copy/move/recycle with undo), `zip`
  compress with progress, Nearby Share via `IDataTransferManagerInterop`, USB eject via
  `CM_Request_Device_EjectW`, "Open with", "Reveal". Confirm destructive actions.
- **M4-E2 Shelf** — persisted items (files, text, images) in SQLite + `%LOCALAPPDATA%\Muna\
  shelf`; drag-out with `tauri-plugin-drag` (`DoDragDrop`); clipboard history
  (`Clipboard.HistoryChanged`) as a source; expiry rules.
- **M4-E3 Window snap** (`muna-shell-engineer`) — zones appear on `EVENT_SYSTEM_MOVESIZESTART`
  when the cursor nears the notch; `SetWindowPos` with `DWMWA_EXTENDED_FRAME_BOUNDS`
  compensation; eligibility filter; layouts (halves, thirds, quarters, custom); per-monitor.
- **M4-E4 Code hosting** — GitHub device flow; GitLab PAT/OAuth; PR list, review requests,
  checks status, notifications; ETag + `X-Poll-Interval`; live activity for CI finished on
  your PR.
- **M4-E5 AI coding status** — adapters for Claude Code (`~/.claude/projects/**/*.jsonl`
  tail), Codex CLI, Copilot CLI; terminal title watching; local webhook receiver
  (`127.0.0.1`, random port, token) for hooks; live activity "Waiting for input".
- **M4-E6 Keyboard shortcuts** — `tauri-plugin-global-shortcut`; conflicts detection;
  command palette in the panel (Ctrl+Shift+Space default) listing module actions.
- **M4-E7 Notes** — markdown-lite notes in SQLite; quick note from strip; pinned note widget.
- **M4-E8 Screen time** — foreground tracking via WinEvent + idle detection; daily/weekly
  charts; per-app limits notice; all local.
