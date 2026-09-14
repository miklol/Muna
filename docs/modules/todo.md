# Todo

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

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
