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

## Plan (muna-architect, 2026-09-26)

M3 is built and stacked (#22 → … → #37), so M4 stacks on `m3-close-out` and merges after it;
the stack is deep, but every epic touches the registry and the settings model that M3 changed,
and branching from `main` would only move the conflicts. One PR per epic, phases A–E as in M3
(platform → Rust module → contract → UI → docs and PR), each PR passing `pnpm -w ci`,
`ci:rust`, `ci:deps` and `ci:app` locally while the Actions budget is out.

### Progress

- **M4-E6 Keyboard shortcuts — built** (branch `m4-e6-keyboard-shortcuts`, stacked on
  `m3-close-out`). What changed against the plan below: the settings namespace is
  `settings.modules["keyboard-shortcuts"]` (the module id, like every other module) and gains
  `snoozeMinutes`; `set_hotkey` returns the full binding list (`Result<HotkeyBinding[],
  IpcError>` with codes `hotkey.invalid | inUse | taken`) so the pane needs no second read;
  `ModuleAction.run` receives a `ModuleActionContext` (`openModule`, `send`) instead of being
  parameterless; `hotkeyDefault` was dropped — defaults live in the zod schema. The desktop
  Storybook harness (`apps/desktop/.storybook`, [09 → Module stories](../09-testing-qa.md#module-stories-appsdesktopstorybook))
  shipped here as planned, with stories for the pane, the palette and the key caps; the M3
  modules' stories stay a carry-over. `ShellToggleRequested` is gone (pre-1.0 break; the shell
  was its only consumer). Details in
  [keyboard-shortcuts → Implementation notes](../modules/keyboard-shortcuts.md#implementation-notes-m4-e6).

### Order

| # | Epic | Why here | Depends on |
| --- | ------ | ---------- | ------------ |
| 1 | M4-E6 Keyboard shortcuts | Smallest; adds the **action registry** (`ModuleDefinition.actions`) and the palette that the other epics register into; generalises the toggle hotkey already in `shell/manager.rs` | — |
| 2 | M4-E1 Drop actions | The riskiest exit criterion, so it goes early; owns the shell's *Drop* state deferred since M1 | E6 (actions) |
| 3 | M4-E2 Shelf | Its first item source is the *Shelf* drop tile; drag-out is the second risky criterion | E1 |
| 4 | M4-E3 Window snap | Independent shell work; mixed-DPI criterion | — |
| 5 | M4-E4 Code hosting | First network integration; the 24 h soak needs the module early | E6 (refresh action) |
| 6 | M4-E7 Notes | Small; *quick note* binds through E6 | E6 |
| 7 | M4-E8 Screen time | New foreground hook and idle traits; no drag risk | — |
| 8 | M4-E5 AI coding status | Local receiver plus file tailing; last because its adapters change fastest | E6 (allow / deny) |

### Cross-cutting contract changes (additive)

- `ModuleDefinition.actions?: readonly ModuleAction[]` with
  `ModuleAction = { id, labelKey, run(): void | Promise<void>, hotkeyDefault? }`; ids are
  `<module>.<verb>` (`todo.quickAdd`, `notes.quickNote`, `pomodoro.toggle`,
  `media.playPause`). The shell's own actions (toggle panel, snooze, next / previous module,
  open module *N*) live in `src/shell/actions.ts`.
- Settings: `settings.modules.keyboardShortcuts = { bindings: Record<actionId, chord>,
  onlyWhileHovering: boolean }`; `settings.shell.toggleHotkey` keeps working and migrates
  into `bindings['shell.togglePanel']` (settings version bump with a test).
- Commands `set_hotkey(action, chord) -> Result<(), HotkeyError>` where
  `HotkeyError::InUse` comes from `RegisterHotKey` failing (the plugin surfaces it), and
  `clear_hotkey(action)`; event `HotkeyPressed { action, label }` replaces the toggle-only
  event. Drop actions add `DropEntered { items, label }`, `DropLeft`, `drop_run(action,
  items)`, `DropProgress`; Shelf adds `shelf_*` commands and `ShelfChanged`; Window snap adds
  `SnapDragChanged { hwnd, cursor }` and `snap_apply(zone)`; Code hosting and AI coding follow
  the `get_<module>_snapshot` + `<Module>Changed` pattern of M3.
- Every new contract type gets a zod schema in `packages/contracts/src/schemas.ts` and a
  round-trip test; bindings regenerate with `--export-bindings`.

### Platform traits (new in `muna-platform`, all scripted in `FakePlatform`)

| Trait | Windows implementation | Epic |
| ------- | ------------------------ | ------ |
| `DropTarget` | Tauri `dragDropEnabled` events on the notch window first; `IDropTarget` on the window only if Tauri does not deliver *enter / over / leave* on a non-focusable transparent window (spike S1) | E1 |
| `FileOps` | `IFileOperation` (copy, move, recycle with `FOF_ALLOWUNDO`), `CM_Request_Device_EjectW`, `ShellExecuteExW`, `DataTransferManager` via `IDataTransferManagerInterop` | E1, E2 |
| `DragSource` | `DoDragDrop` with a `CF_HDROP` / `CF_UNICODETEXT` data object on the UI thread; thumbnails via `IShellItemImageFactory` | E2 |
| `WindowEvents` | `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART / END, EVENT_SYSTEM_FOREGROUND)` on a dedicated message-pump thread, `DWMWA_EXTENDED_FRAME_BOUNDS`, `SetWindowPos`, `GetLastInputInfo` | E3, E8 |
| `AppIcons` | `SHGetFileInfoW` → PNG bytes, cached by path | E8 |
| `Http` | `reqwest` with ETag / `If-None-Match` and a per-host poll-interval, only inside user-enabled integrations; tokens in Credential Manager through `keyring` | E4 |
| `LocalReceiver` | `127.0.0.1` listener on a random port with a per-launch token; body size and rate limits | E5 |

### Spikes with exit criteria

- **S1 Drop on the notch window** (before E1 phase A): a Tauri `drag-drop` listener on the
  `notch` window reports *enter*, *over* with coordinates and *leave* while Explorer drags
  files over the transparent strip, without the window taking focus. Exit: three events
  logged in a manual run and the strip never activates; otherwise `IDropTarget` behind a
  feature flag.
- **S2 Drag-out from the webview** (before E2): `DoDragDrop` started from a Tauri command
  while the pointer is down lands a file in Explorer and in Chrome's file input. Exit: both
  targets receive the file; the webview does not start its own HTML5 drag.
- **S3 WinEvent hook thread** (before E3): a hook on its own thread delivers
  `MOVESIZESTART` within 16 ms and stops cleanly on shutdown (no orphan thread). Exit: timing
  logged, `cargo test` for the fake, a manual run.
- **S4 GitHub device flow** needs a registered OAuth app (client id) from the maintainer;
  until then E4 ships PAT auth only and the device flow behind the same trait.

### Risks

- Actions budget: nothing merges until it is restored; the stack keeps growing, so every PR
  body records its local parity results.
- `IFileOperation` and `DoDragDrop` need an STA thread; run them on a dedicated COM thread in
  `muna-platform`, never on tokio workers.
- Drop tiles compete with the shell's yield rules (docs/modules/notch-shell.md): a drag over
  the strip must win over Peek and lose to fullscreen holds; encode it in the state machine
  first, with tests, then wire the platform.
- Screen time is personal data: local only, export CSV, an explicit *Exclude this app* row;
  never log window titles.
- Window snap on mixed DPI: compute in physical pixels per monitor and compensate the frame
  bounds; the acceptance test is a fake-platform table of monitors and windows.

### Test plan

Fake-platform Rust suites per module (`tests/<module>.rs`), Vitest for reducers, panels and
settings panes, contract schema round-trips, `ci:app` idle budget after each epic (all M3
and M4 modules on), the QA checklists `docs/qa/checklists/{drop-actions,shelf,window-snap,
code-hosting}.md` for the hardware and application rows, and the module story harness as
the first M4-E6 deliverable so every new module ships with stories.
