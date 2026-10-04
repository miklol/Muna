# M4 · Power tools

Read `docs/07-roadmap.md#m4--power-tools-4-weeks`. Requires M3 merged. Use the generic module
prompt from [m3-daily-modules.md](m3-daily-modules.md#generic-module-prompt) with these notes.

- **M4-E1 Drop actions** (`muna-shell-engineer` + `muna-module-developer`) — Tauri
  `onDragDropEvent` (native OLE; HTML5 DnD stays off), drop tiles morph per
  docs/06-motion-spec.md; actions via `IFileOperation` (copy/move/recycle with undo), `zip`
  compress with progress, Nearby Share via `IDataTransferManagerInterop`, USB eject via
  `CM_Request_Device_EjectW`, "Open with", "Reveal". Confirm destructive actions.
- **M4-E2 Shelf** — persisted items (files, text, images) in SQLite + `%LOCALAPPDATA%\Muna\
  shelf`; drag-out with `DoDragDrop` (validated by spike S2 below); clipboard history
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
- **M4-E1 Drop actions — built** (branch `m4-e1-drop-actions`, stacked on
  `m4-e6-keyboard-shortcuts`). Spike S1 passed on the first try
  ([spikes/m4-drop](../spikes/m4-drop.md): *enter* 65–80 ms, *leave* 32 ms, no activation), so
  the `DropTarget` row below collapsed into the shell manager's `WindowEvent::DragDrop` handler
  and no native `IDropTarget` or feature flag was written. Against the plan: the drag events are
  `DropEntered { session, label, items, position }`, `DropMoved`, `Dropped` and `DropLeft` with
  the paths kept in Rust (`muna_core::drops::DropSessions`) and the UI seeing names and kinds
  only; `drop_run(session, action)` works on a session rather than on items; `DropProgress`
  became the `DropActionsChanged` snapshot plus a strip activity per long job. "Confirm
  destructive actions" was not built: recycle goes through `IFileOperation` with
  `FOF_ALLOWUNDO`, so Explorer's Undo is the safety net and a confirmation would only add a
  click. The row is a new module surface (`ModuleDefinition.drop`) and a new shell state
  (`drop`); the *Shelf*, *Convert* and *Music* tiles wait for their modules. Details in
  [drop-actions → Implementation notes](../modules/drop-actions.md#implementation-notes-m4-e1);
  hardware and application rows in [qa/checklists/drop-actions](../qa/checklists/drop-actions.md).
- **M4-E2 Shelf — built** (branch `m4-e2-shelf`, stacked on `m4-e1-drop-actions`). Spike S2
  passed on its first complete run ([spikes/m4-drag](../spikes/m4-drag.md): `DoDragDrop` from
  a Tauri command on the main thread enters OLE 37–43 ms after the gesture, lands in Explorer
  and a browser file input, the strip never activates), so the `DragSource` row below stands as
  designed and no drag-proxy window was written. Against the plan: `tauri-plugin-drag` is not
  used (the shell has its own `DragSource` with `SHDoDragDrop` and the shell's data object);
  the self-drop guard is an in-process flag (`DropSessions::self_drag`) instead of the private
  clipboard format S2 suggested; the drop tile reaches the Shelf through
  `muna_core::ShelfIntake` (the only seam between the two Rust modules) and is dimmed while the
  Shelf is turned off; clipboard history as a source did **not** ship — it would park every
  copy and needs an opt-in toggle the spec does not have; images are files, a pasted bitmap is
  not an item. Thumbnails are Explorer's (`IShellItemImageFactory` → `GetDIBits` → PNG) at
  128 device px, cached per item. Details in
  [shelf → Implementation notes](../modules/shelf.md#implementation-notes-m4-e2); hardware and
  application rows in [qa/checklists/shelf](../qa/checklists/shelf.md).
- **M4-E3 Window snap — built** (branch `m4-e3-window-snap`, stacked on `m4-e2-shelf`). Spike
  S3 passed ([spikes/m4-snap](../spikes/m4-snap.md): the hook path holds an event in
  0.64 ms median, `MOVESIZESTART` lands 42 ms after the first movement, the pump joins in
  2 ms), so the M1 pump stays the only `WindowEvents` source and `MoveSizeChanged` gained the
  dragged window's handle. Against the plan: the contract is `SnapDragMoved { label, session,
  position }` / `SnapDragLeft` / `SnapDragEnded { session, label }` with `snap_apply(session,
  label, zone)` and `snap_cancel(session)` rather than `SnapDragChanged { hwnd, cursor }` and
  `snap_apply(zone)` — the window handle never leaves Rust (`muna_core::snap::SnapSessions`),
  positions are per notch window in its CSS px, and the window under the cursor at release
  resolves the tile; the zones are a new module surface (`ModuleDefinition.snap`) and a new
  shell state (`snap`), like the drop row; the DWM thumbnail preview did not ship. Placement
  is by `DWMWA_EXTENDED_FRAME_BOUNDS` with the invisible border added back, posted with
  `SWP_ASYNCWINDOWPOS` / `ShowWindowAsync`, and verified 120 ms later against Aero Snap and
  per-monitor-DPI resizes. Details in
  [window-snap → Implementation notes](../modules/window-snap.md#implementation-notes-m4-e3);
  hardware rows in [qa/checklists/window-snap](../qa/checklists/window-snap.md).
- **M4-E4 Code hosting — built** (branch `m4-e4-code-hosting`, stacked on
  `m4-e3-window-snap`). GitHub behind a personal access token: one GraphQL request per poll
  (`viewer` plus the *review-requested* and *author* searches with the check rollup), every
  two minutes while on, connected and unlocked, backing off to 30 minutes on failures and
  stopping on a refused token; the token in Credential Manager (`muna_platform::Secrets`)
  read at every poll, the last queue cached in `Store` meta for an offline start; the two
  strip notices at priority 45 with a cap of three per poll; the panel with *To review /
  Mine / All* chips, the widget, and the pane with the masked connect form and *Disconnect*.
  Against the plan: **GraphQL, not REST** — ETag / `If-None-Match` and `X-Poll-Interval` do
  not apply, the fixed two-minute cadence, the backoff and the `rateLimited` case are the
  rate-limit friendliness the soak measures; **no `Http` platform trait** — `reqwest` stays
  inside the module behind the `CodeHost` trait like the weather and calendar providers, so
  the row below did not materialise; **no avatars** (the notch's CSP allows only local images
  and the UI never makes network calls; rows show the author's initial); **a notice, not a
  live activity**, for finished checks; **PAT only** — spike S4's device flow still waits for
  a maintainer OAuth client id and plugs into the same trait; GitLab, Bitbucket, Jira and
  GitHub notifications are deferred. The module's Rust `FetchError` is `CodeHostError`:
  specta refuses two exported types with one name. Turning the module off keeps the token,
  the cache **and the account in view**, so the pane still offers *Disconnect*. Details in
  [code-hosting → Implementation notes](../modules/code-hosting.md#implementation-notes-m4-e4);
  network and account rows in [qa/checklists/code-hosting](../qa/checklists/code-hosting.md).
- **M4-E7 Notes — built** (branch `m4-e7-notes`, stacked on `m4-e4-code-hosting`). Plain
  `.md` files in a folder (`%APPDATA%\Muna\notes` by default, or one the user chooses), the
  title is the file name, saves carry the baseline modified time and are refused on a conflict,
  deletes go to the Recycle Bin; the list, search (Rust full text, 150 ms after the last
  keystroke), inline *New note*, the editor with 600 ms autosave, rename, pin, markdown-lite
  preview, *Show in Explorer* and *Move to Recycle Bin*; the `notes.quickNote` action opens
  *Inbox* with the caret at the end; the pinned-note widget; the folder pane. Against the plan:
  **files, not SQLite** — the row below said "markdown-lite notes in SQLite", but the module
  document's acceptance criterion is "plain `.md` readable by other apps", so the folder is the
  database and `Store` meta holds only the pins (`notes:pins`); **no file watcher** — every
  snapshot is a rescan on open and after every write, so an idle app costs nothing and other
  apps' edits show up the next time the panel opens; preview links are shown, not followed (no
  open-URL command; the notch does not open addresses read from a file). `@muna/ui` gained the
  `TextArea` primitive. Details in
  [notes → Implementation notes](../modules/notes.md#implementation-notes-m4-e7); folder and
  other-app rows in [qa/checklists/notes](../qa/checklists/notes.md).
- **M4-E8 Screen time — built** (branch `m4-e8-screen-time`, stacked on `m4-e7-notes`). No new
  hook: the shell's foreground, idle and lock signals become spans per lower-case executable in
  SQLite (migration 5: `usage_apps`, `usage_sessions`); a 10 s tick only while on and unlocked
  pauses at the moment input stopped, splits at the day-reset hour, flushes once a minute,
  checks per-app limits (the `screenTimeLimit` strip notice, priority 42, once a day) and
  prunes 90 days back. The snapshot carries the tracking state, the app in front, today's
  totals, the top 20 apps with icons, the categories, the last seven days and the excluded
  list, and is published only while a notch window watches. Commands exclude (which forgets
  the app's history), include, set category, set limit and clear history; CSV export to a
  picked folder. The panel has the head chips, the donut with the legend and the session
  facts, the now card, the ranking with limit bars, the week as stacked bars and an app's
  details; the widget shows the small donut and what is in front; the pane has counting, idle,
  day start, the excluded apps, export and clear. Against the plan: **`AppInfo`, not
  `AppIcons`** — one call gives the version resource's display name and the shell icon through
  the shelf's image factory, so `SHGetFileInfoW` was not needed; **no `SetWinEventHook`
  work** — E3 already raised `EVENT_SYSTEM_FOREGROUND`; browser-tab attribution stays deferred
  (titles are never read); UWP apps count as `applicationframehost.exe`. `@muna/ui` gained the
  `SegmentedRing` primitive. Details in
  [screen-time → Implementation notes](../modules/screen-time.md#implementation-notes-m4-e8);
  attribution and privacy rows in [qa/checklists/screen-time](../qa/checklists/screen-time.md).
- **M4-E5 AI coding status — built** (branch `m4-e5-ai-coding`, stacked on
  `m4-e8-screen-time`). The `Processes` trait (`main_window(pid)`,
  `owner_of_local_port(port)` over `GetExtendedTcpTable`) is the only platform addition. The
  `LocalReceiver` row became `ai_coding::receiver`: hyper on `127.0.0.1`, a **configured port**
  (47391, the next ten tried when taken) rather than the random one planned — hook URLs are
  static configuration in the agents' own files — a per-install bearer token in the store's
  `meta` table, 64 KiB bodies, 30 requests a second, and a `PermissionRequest` **held** up to
  25 s for the strip's answer. Claude Code posts seven hook events (*Install hooks* writes and
  removes exactly those in `~\.claude\settings.json`), its transcript is tailed for usage and
  the branch is read from `HEAD` without a `git` process; Copilot CLI has no hooks, so live
  sessions are its `inuse.<pid>.lock` files and `events.jsonl` is followed on a 2 s / 10 s
  cadence (no `notify` watcher, nothing while off or locked); any process may post the
  generic document. A decidable prompt is the `ai-coding:waiting:<session>` activity
  (priority 62, `Trailing::Decision`), everything else that stops for the user a notice. The
  panel, the widget and the pane as specified; `@muna/ui` gained the `DecisionButtons`
  primitive and the strip a `decision` slot. Not built: the `SendInput('y')` fallback (a
  decision reaches only an agent that can take it), Cursor / Codex adapters (the generic
  route stands in), Copilot token counts (the CLI reports none). Details in
  [ai-coding → Implementation notes](../modules/ai-coding.md#implementation-notes-m4-e5);
  timing and receiver rows in [qa/checklists/ai-coding](../qa/checklists/ai-coding.md).

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
| `WindowEvents` | `SetWinEventHook(EVENT_SYSTEM_MOVESIZESTART / END, EVENT_SYSTEM_FOREGROUND)` on a dedicated message-pump thread, `DWMWA_EXTENDED_FRAME_BOUNDS`, `SetWindowPos`, `GetLastInputInfo` — built for E3 as `MoveSizeChanged { started, window }` plus the `WindowPlacement` trait (`is_snappable`, `frame_bounds`, `place`, `maximize`); E8 added `Foreground::idle_for` (`GetLastInputInfo`) and `ForegroundWindow.process_path` | E3, E8 |
| `AppIcons` | Built as `AppInfo::describe(path, px)`: the version resource's `FileDescription` plus the shell icon through `IShellItemImageFactory` (the shelf's renderer), not `SHGetFileInfoW` | E8 |
| `Http` | `reqwest` with ETag / `If-None-Match` and a per-host poll-interval, only inside user-enabled integrations; tokens in Credential Manager through `keyring` | E4 |
| `LocalReceiver` | Built as `ai_coding::receiver` (hyper on `127.0.0.1`, configured port with ten retries, per-install bearer token from the store's `meta`, 64 KiB bodies, 30 req/s, held permission requests); the platform side is the `Processes` trait — `main_window(pid)` and `owner_of_local_port(port)` via `GetExtendedTcpTable` | E5 |

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
  logged, `cargo test` for the fake, a manual run. **Done — go**
  ([spikes/m4-snap](../spikes/m4-snap.md)).
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

## Stack and merge order

Every M4 epic landed as one PR stacked on the previous one so each could be reviewed against
its own diff; the run sits on the M3 close-out because nothing has merged since M1:

| PR | Epic | Base |
| --- | ------ | ------ |
| [#38](https://github.com/miklol/Muna/pull/38) | M4-E6 Keyboard shortcuts (+ module story harness) | `m3-close-out` (#37) |
| [#39](https://github.com/miklol/Muna/pull/39) | M4-E1 Drop actions | #38 |
| [#40](https://github.com/miklol/Muna/pull/40) | M4-E2 Shelf | #39 |
| [#41](https://github.com/miklol/Muna/pull/41) | M4-E3 Window snap | #40 |
| [#42](https://github.com/miklol/Muna/pull/42) | M4-E4 Code hosting (GitHub, token) | #41 |
| [#43](https://github.com/miklol/Muna/pull/43) | M4-E7 Notes | #42 |
| [#44](https://github.com/miklol/Muna/pull/44) | M4-E8 Screen time | #43 |
| [#45](https://github.com/miklol/Muna/pull/45) | M4-E5 AI coding status | #44 |

Merge from the bottom of the M2 stack upwards (#22 → … → #37 → #38 → … → #45) with
`scripts/land-stack.ps1`: squash-merge one PR, retarget its child to `main`, rebase only the
child's own commits onto `main` and force-push it, then wait for the child's checks (a child
that is merely retargeted shows its parent's changes as conflicts, because the squash rewrote
them). Every PR passes the parity commands locally (`pnpm -w ci`, `ci:rust`, `ci:deps`,
`ci:app`, the docs checks); the hosted checks have not run because the GitHub Actions budget
is exhausted ("an Actions budget is preventing further use" on every job). When it is
restored, the script reruns each never-started run once and stops on anything else.

What the parity runs caught that the unit suites could not, for the record: a shell ↔ UI
ready loop and a leaking morph sampler (M2-E4), and in M4-E5 a startup deadlock between the
ai-coding poll and the main thread over a window of Muna's own process, plus the Copilot
CLI's one-turn-per-response log. Each fix has a regression test; the deadlock's is a live
platform test.

Carry-overs (listed against the M4 exit criteria in
[07-roadmap → M4](../07-roadmap.md#m4--power-tools-4-weeks)): the manual hardware and
application rows of the four checklists (Explorer, Chrome, Outlook, Teams, a 100 % + 150 %
monitor pair, the 24 h GitHub soak); an `IDropTarget` of Muna's own so Outlook's virtual-file
attachments drop; the GitHub device flow, GitLab, Bitbucket and Jira; Cursor and Codex
adapters and a two-phase ai-coding poll; the Storybook module states for the M3 modules
(harness in place since #38); the Windows 10 columns of every checklist; and the M0–M3
carry-overs that still stand.
