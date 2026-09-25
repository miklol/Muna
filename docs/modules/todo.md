# Todo

**Tier P1 · Owner: `muna-module-developer` · Status: implemented (M3-E2; local-first — sync,
quick-add hotkey, notes, reorder and Day Progress/Dashboard feeds deferred — see
[Implementation notes](#implementation-notes-m3-e2))**

## Reference

`demo-11`, `demo-07`, `todo-feature-2`. List with radio circles, due dates ("7. Aug at 18:00"),
trash with retention/restore. Strip: "Tasks" collapsed view (count or next due).

## Data

Local-first SQLite table (`tasks`: id, title, notes, due, completed_at, deleted_at, list_id,
remote_id, provider). Optional two-way sync:

- Microsoft To Do (Graph `/me/todo/lists/{id}/tasks`, delta).
- Google Tasks (`tasks.list`).
Conflict rule: last-write-wins by `updated_at`; deletions soft for 30 days (retention setting).

## Behaviour

Add (natural-language date parse via `chrono-node`), complete with a spring check animation,
delete → Trash, restore, reorder, multiple lists, quick add from strip hotkey. Feeds Day
Progress and Dashboard.

## Acceptance criteria

- Add "Call Sam tomorrow 3pm" → due parsed correctly in the user's locale/timezone.
- Completing a synced task reflects remotely within one sync cycle (≤ 60 s) and vice-versa.
- Trash auto-purges after the retention period.

## Implementation notes (M3-E2)

Pieces, in the order the data flows:

- **Storage** (`muna-core::tasks`, migration 3): `task_lists` (`id`, `name`, `sort_order`) and
  `tasks` (`id`, `list_id`, `title`, `notes`, `due_ms`, `all_day`, `completed_at_ms`,
  `deleted_at_ms`, `sort_order`, `created_at_ms`, `updated_at_ms`, plus `remote_id` and
  `provider` reserved for sync). The default list `inbox` has no stored name; the UI localises
  it ("Tasks") and it cannot be deleted. New tasks go on top (`sort_order` below the current
  minimum) so they are visible in a 360 px panel. Deleting a list moves its tasks to the inbox
  and into the trash, then drops the list.
- **Service** (`src-tauri/src/modules/todo`): one task per app, woken by a `Notify` after every
  command or settings change, at the next due-time boundary it computes (`next_wake`), and on
  session unlock. Each evaluation purges trash older than the retention period and publishes
  the strip: the `todo:due` activity (priority `TASK_DUE` 55, `CheckCircle` glyph, the title,
  `Trailing::Time` with the due time) for the earliest open timed task due within the next 60
  minutes (`LEAD`), kept up to 15 minutes past its time (`GRACE`); and a `todo:due:<id>` notice
  for tasks that came due since the last evaluation. Nothing is announced at start-up, so dues
  that passed while the app was closed stay quiet. All-day tasks never reach the strip.
- **Contract**: `get_todo_snapshot`, `todo_command({add | rename | setNotes | setDue | complete
  | delete | restore | purge | emptyTrash | reorder | addList | renameList | deleteList})` and
  the `TodoChanged` event; the snapshot carries the lists, every task (open, completed and
  trashed) and the retention in force. Blank titles and names are refused (`todo.emptyTitle`,
  `todo.emptyName`). Millisecond timestamps are `i64` in Rust and export as plain `number`
  through the `Int53` marker ([M0 → IPC rule](../build-plan/m0-foundations.md)).
- **Panel** (`apps/desktop/src/modules/todo`): a quick-add `TextField` that reads dates in
  words through `chrono-node/en` (`parseTask`: the phrase leaves the title, "by"/"on"/"at"
  connectors go with it, a phrase without a time makes an all-day task, weekdays resolve
  forward, a bare date stays the title) with a due-preview `Chip` while typing; the lists as a
  `SegmentedControl` when there is more than one; task rows with the `Checkbox` primitive's
  spring check, the due date on the right (today/tomorrow/yesterday by name, otherwise weekday
  and date, `--accent-red` once overdue with the word for readers) and move-to-trash on hover;
  "Clear completed"; a trash view with restore, "Empty trash" and the retention note. Rows
  enter and leave with the `content` recipe and slide with the `layout` spring; the list scrolls
  inside the panel's 360 px maximum. The panel keeps no timers: due labels read the time the
  snapshot arrived.
- **Settings** (`settings.modules.todo`, zod mirror in `@muna/contracts`): retention 1–365 days
  (default 30), show the next due task in the strip (on), announce a task when due (on), and
  the lists (add, delete). Out-of-range values clamp, wrong types fall back to the defaults for
  the whole entry.
- **Tests**: `tests/todo.rs` (24; `FakeClock` + in-memory `Store`) covers the commands, the
  default list, list deletion, the activity window, the notice, silence at start-up, purge,
  settings and unlock; `muna-core` unit tests cover the storage; Vitest covers `parseTask` and
  the due labels, the store helpers, the panel and the settings pane; `strip-content` tests
  cover the `taskDue` message and the `time` slot.

Deviations from the spec above, decided in M3-E2:

- **Sync is deferred.** Microsoft To Do and Google Tasks need OAuth, a token store in Credential
  Manager and a network integration the user enables; the schema keeps `remote_id`/`provider`
  for it. The second acceptance criterion waits for that epic.
- **No quick-add hotkey, notes editor, task rename or drag reorder yet.** The commands exist
  (`rename`, `setNotes`, `reorder`); the surfaces come with the P2 polish pass once the module
  bar and shortcuts settle. Day Progress and Dashboard read the store when those modules land.
- **English date grammar only.** `chrono-node` ships other grammars; they are wired when the
  message catalog gains those locales, so the parser and the UI change language together.
- **Trash spans every list.** One trash view lists deleted tasks from all lists, latest first;
  per-list trash added nothing but clicks.
