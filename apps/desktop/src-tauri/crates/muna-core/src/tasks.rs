//! Task storage for the todo module (docs/modules/todo.md, "Data"): lists, tasks, the trash
//! and the due-date queries the strip needs. Pure SQL over [`Store`]; the module in the app
//! crate owns the behaviour (what is due, when to announce it) and the time.
//!
//! Times are Unix milliseconds. A task with `due_ms` and `all_day == false` is due at that
//! instant; with `all_day == true` it is due on that day (local midnight) and never announced.

use rusqlite::{OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::store::{Store, StoreError};
use crate::wire::Int53;

/// The list every profile has; it cannot be deleted and its `name` is `None` until renamed
/// (the UI shows a localised "Tasks").
pub const INBOX_LIST_ID: &str = "inbox";

/// One list of tasks.
///
/// Millisecond and order fields are `i64` in Rust and SQLite and export as `number` through
/// [`Int53`] (they stay far below 2^53).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: String,
    /// `None` for the default list (localised by the UI).
    pub name: Option<String>,
    #[specta(type = Int53)]
    pub sort_order: i64,
}

/// One task, in any state: open, completed (`completed_at_ms`) or in the trash
/// (`deleted_at_ms`). The title and notes are content and are never logged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub notes: String,
    #[specta(type = Option<Int53>)]
    pub due_ms: Option<i64>,
    /// `due_ms` names a day, not a moment.
    pub all_day: bool,
    #[specta(type = Option<Int53>)]
    pub completed_at_ms: Option<i64>,
    #[specta(type = Option<Int53>)]
    pub deleted_at_ms: Option<i64>,
    /// Ascending within the list; new tasks go on top.
    #[specta(type = Int53)]
    pub sort_order: i64,
    #[specta(type = Int53)]
    pub created_at_ms: i64,
    #[specta(type = Int53)]
    pub updated_at_ms: i64,
}

/// What a new task needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewTask<'a> {
    pub list_id: &'a str,
    pub title: &'a str,
    pub notes: &'a str,
    pub due_ms: Option<i64>,
    pub all_day: bool,
}

/// A due date as stored: the instant and whether it names a whole day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Due {
    pub at_ms: i64,
    pub all_day: bool,
}

/// Fields to change on a task; `None` leaves a field alone and `due: Some(None)` clears it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TaskPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub due: Option<Option<Due>>,
}

const TASK_COLUMNS: &str = "id, list_id, title, notes, due, all_day, completed_at, deleted_at, \
                            sort_order, created_at, updated_at";

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        list_id: row.get(1)?,
        title: row.get(2)?,
        notes: row.get(3)?,
        due_ms: row.get(4)?,
        all_day: row.get(5)?,
        completed_at_ms: row.get(6)?,
        deleted_at_ms: row.get(7)?,
        sort_order: row.get(8)?,
        created_at_ms: row.get(9)?,
        updated_at_ms: row.get(10)?,
    })
}

fn list_from_row(row: &Row<'_>) -> rusqlite::Result<TaskList> {
    Ok(TaskList {
        id: row.get(0)?,
        name: row.get(1)?,
        sort_order: row.get(2)?,
    })
}

impl Store {
    /// Every list, in display order.
    pub fn task_lists(&self) -> Result<Vec<TaskList>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(
            "SELECT id, name, sort_order FROM task_lists ORDER BY sort_order, created_at, id",
        )?;
        let lists = statement
            .query_map([], list_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(lists)
    }

    /// Every task that has not been purged, open and completed and trashed alike, in list
    /// order then display order.
    pub fn tasks(&self) -> Result<Vec<Task>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {TASK_COLUMNS} FROM tasks ORDER BY list_id, sort_order, created_at DESC, id"
        ))?;
        let tasks = statement
            .query_map([], task_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    pub fn task(&self, id: &str) -> Result<Option<Task>, StoreError> {
        let conn = self.connection();
        Ok(conn
            .query_row(
                &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"),
                params![id],
                task_from_row,
            )
            .optional()?)
    }

    /// Adds a task at the top of its list. Fails when the list does not exist.
    pub fn insert_task(&self, task: &NewTask<'_>, now_ms: i64) -> Result<Task, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
        tx.execute(
            "INSERT INTO tasks (id, list_id, title, notes, due, all_day, sort_order, \
             created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, \
             (SELECT COALESCE(MIN(sort_order), 0) - 1 FROM tasks WHERE list_id = ?2), ?7, ?7)",
            params![
                id,
                task.list_id,
                task.title,
                task.notes,
                task.due_ms,
                task.all_day,
                now_ms
            ],
        )?;
        let inserted = tx.query_row(
            &format!("SELECT {TASK_COLUMNS} FROM tasks WHERE id = ?1"),
            params![id],
            task_from_row,
        )?;
        tx.commit()?;
        Ok(inserted)
    }

    /// Changes title, notes or due date. Returns `false` when the task does not exist.
    pub fn update_task(
        &self,
        id: &str,
        patch: &TaskPatch,
        now_ms: i64,
    ) -> Result<bool, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let mut changed = 0;
        if let Some(title) = &patch.title {
            changed = tx.execute(
                "UPDATE tasks SET title = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, title, now_ms],
            )?;
        }
        if let Some(notes) = &patch.notes {
            changed = tx.execute(
                "UPDATE tasks SET notes = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, notes, now_ms],
            )?;
        }
        if let Some(due) = patch.due {
            changed = tx.execute(
                "UPDATE tasks SET due = ?2, all_day = ?3, updated_at = ?4 WHERE id = ?1",
                params![
                    id,
                    due.map(|due| due.at_ms),
                    due.is_some_and(|due| due.all_day),
                    now_ms
                ],
            )?;
        }
        let exists = if changed > 0 {
            true
        } else {
            tx.query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )? > 0
        };
        tx.commit()?;
        Ok(exists)
    }

    /// Marks a task done (or open again). Returns `false` when the task does not exist.
    pub fn set_task_completed(
        &self,
        id: &str,
        completed: bool,
        now_ms: i64,
    ) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE tasks SET completed_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, completed.then_some(now_ms), now_ms],
        )?;
        Ok(changed > 0)
    }

    /// Moves a task to the trash (or restores it). Returns `false` when it does not exist.
    pub fn set_task_deleted(
        &self,
        id: &str,
        deleted: bool,
        now_ms: i64,
    ) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE tasks SET deleted_at = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, deleted.then_some(now_ms), now_ms],
        )?;
        Ok(changed > 0)
    }

    /// Removes one trashed task for good. Open tasks are left alone (`false`).
    pub fn purge_task(&self, id: &str) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "DELETE FROM tasks WHERE id = ?1 AND deleted_at IS NOT NULL",
            params![id],
        )?;
        Ok(changed > 0)
    }

    /// Removes every task trashed before `cutoff_ms` (the retention period). Returns how many.
    pub fn purge_tasks_deleted_before(&self, cutoff_ms: i64) -> Result<usize, StoreError> {
        Ok(self.connection().execute(
            "DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?1",
            params![cutoff_ms],
        )?)
    }

    /// Empties the trash. Returns how many tasks went.
    pub fn purge_trash(&self) -> Result<usize, StoreError> {
        Ok(self
            .connection()
            .execute("DELETE FROM tasks WHERE deleted_at IS NOT NULL", [])?)
    }

    /// Puts the given tasks of a list in this order (0, 1, 2, …); tasks not named keep their
    /// order after them.
    pub fn reorder_tasks(
        &self,
        list_id: &str,
        ids: &[String],
        now_ms: i64,
    ) -> Result<(), StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let named = i64::try_from(ids.len()).unwrap_or(i64::MAX);
        // Everything moves to `named..`, keeping its relative order; the named tasks then take
        // `0..named`.
        tx.execute(
            "UPDATE tasks SET sort_order = sort_order \
             - (SELECT COALESCE(MIN(sort_order), 0) FROM tasks WHERE list_id = ?1) + ?2 \
             WHERE list_id = ?1",
            params![list_id, named],
        )?;
        for (position, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE tasks SET sort_order = ?3, updated_at = ?4 WHERE id = ?1 AND list_id = ?2",
                params![
                    id,
                    list_id,
                    i64::try_from(position).unwrap_or(i64::MAX),
                    now_ms
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Adds a list after the existing ones.
    pub fn insert_task_list(&self, name: &str, now_ms: i64) -> Result<TaskList, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let id: String = tx.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
        tx.execute(
            "INSERT INTO task_lists (id, name, sort_order, created_at, updated_at) \
             VALUES (?1, ?2, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM task_lists), ?3, ?3)",
            params![id, name, now_ms],
        )?;
        let inserted = tx.query_row(
            "SELECT id, name, sort_order FROM task_lists WHERE id = ?1",
            params![id],
            list_from_row,
        )?;
        tx.commit()?;
        Ok(inserted)
    }

    /// Renames a list. Returns `false` when it does not exist.
    pub fn rename_task_list(&self, id: &str, name: &str, now_ms: i64) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE task_lists SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name, now_ms],
        )?;
        Ok(changed > 0)
    }

    /// Deletes a list; its tasks move to the default list's trash so they can be restored.
    /// The default list itself is refused (`false`), as is a list that does not exist.
    pub fn delete_task_list(&self, id: &str, now_ms: i64) -> Result<bool, StoreError> {
        if id == INBOX_LIST_ID {
            return Ok(false);
        }
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE tasks SET list_id = ?2, deleted_at = COALESCE(deleted_at, ?3), \
             updated_at = ?3 WHERE list_id = ?1",
            params![id, INBOX_LIST_ID, now_ms],
        )?;
        let changed = tx.execute("DELETE FROM task_lists WHERE id = ?1", params![id])?;
        tx.commit()?;
        Ok(changed > 0)
    }

    /// Open, untrashed tasks with a due *time* (not all-day) in `from_ms..=to_ms`, earliest
    /// first: what became due in a window.
    pub fn timed_tasks_due_between(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<Task>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {TASK_COLUMNS} FROM tasks \
             WHERE due IS NOT NULL AND all_day = 0 AND completed_at IS NULL \
             AND deleted_at IS NULL AND due >= ?1 AND due <= ?2 \
             ORDER BY due, sort_order, id"
        ))?;
        let tasks = statement
            .query_map(params![from_ms, to_ms], task_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(tasks)
    }

    /// The earliest open, untrashed task with a due time at or after `from_ms`.
    pub fn next_timed_task_due_from(&self, from_ms: i64) -> Result<Option<Task>, StoreError> {
        let conn = self.connection();
        Ok(conn
            .query_row(
                &format!(
                    "SELECT {TASK_COLUMNS} FROM tasks \
                     WHERE due IS NOT NULL AND all_day = 0 AND completed_at IS NULL \
                     AND deleted_at IS NULL AND due >= ?1 \
                     ORDER BY due, sort_order, id LIMIT 1"
                ),
                params![from_ms],
                task_from_row,
            )
            .optional()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_700_000_000_000;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn add(store: &Store, title: &str, due: Option<Due>, now_ms: i64) -> Task {
        store
            .insert_task(
                &NewTask {
                    list_id: INBOX_LIST_ID,
                    title,
                    notes: "",
                    due_ms: due.map(|due| due.at_ms),
                    all_day: due.is_some_and(|due| due.all_day),
                },
                now_ms,
            )
            .unwrap()
    }

    fn due_at(at_ms: i64) -> Due {
        Due {
            at_ms,
            all_day: false,
        }
    }

    #[test]
    fn a_fresh_profile_has_the_default_list_only() {
        let lists = store().task_lists().unwrap();
        assert_eq!(lists.len(), 1);
        assert_eq!(lists[0].id, INBOX_LIST_ID);
        assert_eq!(lists[0].name, None);
    }

    #[test]
    fn new_tasks_go_on_top_and_keep_their_fields() {
        let store = store();
        let first = add(&store, "First", None, T0);
        let second = add(&store, "Second", Some(due_at(T0 + 3_600_000)), T0 + 1);
        let tasks = store.tasks().unwrap();
        assert_eq!(
            tasks
                .iter()
                .map(|task| task.title.as_str())
                .collect::<Vec<_>>(),
            ["Second", "First"]
        );
        assert!(second.sort_order < first.sort_order);
        assert_eq!(second.due_ms, Some(T0 + 3_600_000));
        assert!(!second.all_day);
        assert_eq!(second.created_at_ms, T0 + 1);
        assert_eq!(store.task(&first.id).unwrap(), Some(first));
        assert_eq!(store.task("missing").unwrap(), None);
    }

    #[test]
    fn a_task_needs_an_existing_list() {
        let store = store();
        let result = store.insert_task(
            &NewTask {
                list_id: "nowhere",
                title: "Orphan",
                notes: "",
                due_ms: None,
                all_day: false,
            },
            T0,
        );
        assert!(result.is_err());
    }

    #[test]
    fn patching_changes_only_what_is_named() {
        let store = store();
        let task = add(&store, "Call Sam", Some(due_at(T0 + 60_000)), T0);
        assert!(
            store
                .update_task(
                    &task.id,
                    &TaskPatch {
                        notes: Some("about the invoice".into()),
                        ..TaskPatch::default()
                    },
                    T0 + 5,
                )
                .unwrap()
        );
        let after = store.task(&task.id).unwrap().unwrap();
        assert_eq!(after.title, "Call Sam");
        assert_eq!(after.notes, "about the invoice");
        assert_eq!(after.due_ms, Some(T0 + 60_000));
        assert_eq!(after.updated_at_ms, T0 + 5);

        assert!(
            store
                .update_task(
                    &task.id,
                    &TaskPatch {
                        due: Some(None),
                        ..TaskPatch::default()
                    },
                    T0 + 6,
                )
                .unwrap()
        );
        let cleared = store.task(&task.id).unwrap().unwrap();
        assert_eq!(cleared.due_ms, None);
        assert!(!cleared.all_day);

        assert!(
            !store
                .update_task(
                    "missing",
                    &TaskPatch {
                        title: Some("x".into()),
                        ..TaskPatch::default()
                    },
                    T0,
                )
                .unwrap()
        );
        assert!(
            !store
                .update_task("missing", &TaskPatch::default(), T0)
                .unwrap()
        );
        assert!(
            store
                .update_task(&task.id, &TaskPatch::default(), T0)
                .unwrap()
        );
    }

    #[test]
    fn complete_trash_restore_and_purge() {
        let store = store();
        let task = add(&store, "Buy milk", None, T0);
        assert!(store.set_task_completed(&task.id, true, T0 + 1).unwrap());
        assert_eq!(
            store.task(&task.id).unwrap().unwrap().completed_at_ms,
            Some(T0 + 1)
        );
        assert!(store.set_task_completed(&task.id, false, T0 + 2).unwrap());
        assert_eq!(store.task(&task.id).unwrap().unwrap().completed_at_ms, None);

        // Purging an open task does nothing; the trash is the only way out.
        assert!(!store.purge_task(&task.id).unwrap());
        assert!(store.set_task_deleted(&task.id, true, T0 + 3).unwrap());
        assert_eq!(
            store.task(&task.id).unwrap().unwrap().deleted_at_ms,
            Some(T0 + 3)
        );
        assert!(store.set_task_deleted(&task.id, false, T0 + 4).unwrap());
        assert_eq!(store.task(&task.id).unwrap().unwrap().deleted_at_ms, None);
        assert!(store.set_task_deleted(&task.id, true, T0 + 5).unwrap());
        assert!(store.purge_task(&task.id).unwrap());
        assert_eq!(store.task(&task.id).unwrap(), None);
        assert!(!store.set_task_completed("missing", true, T0).unwrap());
    }

    #[test]
    fn retention_purges_old_trash_only() {
        let store = store();
        let old = add(&store, "Old", None, T0);
        let recent = add(&store, "Recent", None, T0);
        let open = add(&store, "Open", None, T0);
        store.set_task_deleted(&old.id, true, T0).unwrap();
        store.set_task_deleted(&recent.id, true, T0 + 10).unwrap();
        assert_eq!(store.purge_tasks_deleted_before(T0 + 5).unwrap(), 1);
        let left: Vec<_> = store
            .tasks()
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert!(left.contains(&recent.id));
        assert!(left.contains(&open.id));
        assert!(!left.contains(&old.id));
        assert_eq!(store.purge_trash().unwrap(), 1);
        assert_eq!(store.tasks().unwrap().len(), 1);
    }

    #[test]
    fn reorder_puts_named_tasks_first_in_the_given_order() {
        let store = store();
        let a = add(&store, "A", None, T0);
        let b = add(&store, "B", None, T0 + 1);
        let c = add(&store, "C", None, T0 + 2);
        // Top to bottom is C, B, A; ask for A, C and leave B where it falls.
        store
            .reorder_tasks(INBOX_LIST_ID, &[a.id.clone(), c.id.clone()], T0 + 3)
            .unwrap();
        let order: Vec<_> = store
            .tasks()
            .unwrap()
            .into_iter()
            .map(|task| task.title)
            .collect();
        assert_eq!(order, ["A", "C", "B"]);
        let _ = b;
    }

    #[test]
    fn lists_are_added_renamed_and_deleted_into_the_trash() {
        let store = store();
        let work = store.insert_task_list("Work", T0).unwrap();
        assert_eq!(work.name.as_deref(), Some("Work"));
        assert_eq!(
            store
                .task_lists()
                .unwrap()
                .iter()
                .map(|list| list.id.as_str())
                .collect::<Vec<_>>(),
            [INBOX_LIST_ID, work.id.as_str()]
        );
        assert!(store.rename_task_list(&work.id, "Office", T0 + 1).unwrap());
        assert_eq!(
            store.task_lists().unwrap()[1].name.as_deref(),
            Some("Office")
        );
        assert!(!store.rename_task_list("missing", "x", T0).unwrap());

        let task = store
            .insert_task(
                &NewTask {
                    list_id: &work.id,
                    title: "Report",
                    notes: "",
                    due_ms: None,
                    all_day: false,
                },
                T0 + 2,
            )
            .unwrap();
        assert!(!store.delete_task_list(INBOX_LIST_ID, T0 + 3).unwrap());
        assert!(store.delete_task_list(&work.id, T0 + 3).unwrap());
        assert!(!store.delete_task_list(&work.id, T0 + 3).unwrap());
        let moved = store.task(&task.id).unwrap().unwrap();
        assert_eq!(moved.list_id, INBOX_LIST_ID);
        assert_eq!(moved.deleted_at_ms, Some(T0 + 3));
        assert_eq!(store.task_lists().unwrap().len(), 1);
    }

    #[test]
    fn due_queries_see_open_timed_tasks_only() {
        let store = store();
        let soon = add(&store, "Soon", Some(due_at(T0 + 1_000)), T0);
        let later = add(&store, "Later", Some(due_at(T0 + 5_000)), T0);
        let all_day = add(
            &store,
            "All day",
            Some(Due {
                at_ms: T0 + 2_000,
                all_day: true,
            }),
            T0,
        );
        let done = add(&store, "Done", Some(due_at(T0 + 3_000)), T0);
        store.set_task_completed(&done.id, true, T0).unwrap();
        let trashed = add(&store, "Trashed", Some(due_at(T0 + 4_000)), T0);
        store.set_task_deleted(&trashed.id, true, T0).unwrap();
        add(&store, "Undated", None, T0);

        let between: Vec<_> = store
            .timed_tasks_due_between(T0, T0 + 5_000)
            .unwrap()
            .into_iter()
            .map(|task| task.id)
            .collect();
        assert_eq!(between, [soon.id.clone(), later.id.clone()]);
        assert_eq!(
            store
                .next_timed_task_due_from(T0 + 1_001)
                .unwrap()
                .map(|task| task.id),
            Some(later.id)
        );
        assert_eq!(store.next_timed_task_due_from(T0 + 5_001).unwrap(), None);
        let _ = all_day;
    }
}
