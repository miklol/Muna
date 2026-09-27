//! SQLite store for module data (clipboard history, notification history, …) at
//! `%LOCALAPPDATA%\Muna\muna.db` (docs/03-architecture.md "Storage").
//!
//! M0 ships the connection, pragmas and a `user_version` migration runner plus one
//! key/value table used for app metadata. Modules add their own migrations in their
//! milestones by appending to [`MIGRATIONS`]; never edit a shipped step.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("database schema version {found} is newer than this build supports ({supported})")]
    Newer { found: u32, supported: u32 },
}

/// Ordered schema steps; index + 1 is the resulting `PRAGMA user_version`.
const MIGRATIONS: &[&str] = &[
    "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    // M3-E3: every pomodoro phase that ran, for "N sessions today" (docs/modules/pomodoro.md).
    "CREATE TABLE pomodoro_sessions (
        id INTEGER PRIMARY KEY,
        phase TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        completed INTEGER NOT NULL
    );
    CREATE INDEX pomodoro_sessions_ended_at ON pomodoro_sessions (ended_at);",
    // M3-E2: task lists and tasks (docs/modules/todo.md, "Data"). Times are Unix milliseconds;
    // `due` is NULL for no due date; `all_day` marks a due date without a time; `deleted_at`
    // is the trash (purged after the retention period); `remote_id`/`provider` wait for sync.
    // The default list is `inbox` with a NULL name, which the UI localises.
    "CREATE TABLE task_lists (
        id TEXT PRIMARY KEY,
        name TEXT,
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES task_lists (id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due INTEGER,
        all_day INTEGER NOT NULL DEFAULT 0,
        completed_at INTEGER,
        deleted_at INTEGER,
        sort_order INTEGER NOT NULL,
        remote_id TEXT,
        provider TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX tasks_list ON tasks (list_id, deleted_at, completed_at, sort_order);
    CREATE INDEX tasks_due ON tasks (due) WHERE deleted_at IS NULL AND completed_at IS NULL;
    INSERT INTO task_lists (id, name, sort_order, created_at, updated_at)
        VALUES ('inbox', NULL, 0, 0, 0);",
    // M4-E2: the Shelf (docs/modules/shelf.md). `path` is set for files (a reference, or a
    // copy inside Shelf storage when `copied` is 1), `text` for snippets; `size` is bytes when
    // known; items keep arrival order.
    "CREATE TABLE shelf_items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        path TEXT,
        text TEXT,
        size INTEGER,
        copied INTEGER NOT NULL DEFAULT 0,
        added_at INTEGER NOT NULL,
        sort_order INTEGER NOT NULL
    );
    CREATE INDEX shelf_items_order ON shelf_items (sort_order, added_at);
    CREATE INDEX shelf_items_added_at ON shelf_items (added_at);",
    // M4-E8: Screen time (docs/modules/screen-time.md). `usage_apps` is one row per executable
    // (`exe` is the lower-case file name), holding the display name and last path for its
    // icon plus the user's choices: `category` overrides the rule table when set, `excluded`
    // apps are never recorded, `limit_minutes` is the daily limit. `usage_sessions` are the
    // foreground spans; the open one is written with its last flush time and moved forward.
    // Never window titles. Times are Unix milliseconds.
    "CREATE TABLE usage_apps (
        exe TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        category TEXT,
        excluded INTEGER NOT NULL DEFAULT 0,
        limit_minutes INTEGER,
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
    );
    CREATE TABLE usage_sessions (
        id INTEGER PRIMARY KEY,
        exe TEXT NOT NULL REFERENCES usage_apps (exe) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL
    );
    CREATE INDEX usage_sessions_span ON usage_sessions (started_at, ended_at);
    CREATE INDEX usage_sessions_exe ON usage_sessions (exe, started_at);",
];

/// One pomodoro phase that ran, as logged by the module. Times are Unix milliseconds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PomodoroSessionRecord {
    /// `work`, `shortBreak` or `longBreak` (the phase's serialised name).
    pub phase: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
    /// `false` when the user skipped or reset it before it ran out.
    pub completed: bool,
}

#[derive(Debug)]
pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// The connection, for the per-domain `impl Store` blocks in sibling modules.
    pub(crate) fn connection(&self) -> parking_lot::MutexGuard<'_, Connection> {
        self.conn.lock()
    }

    pub fn open(path: &Path) -> Result<Self, StoreError> {
        Self::init(Connection::open(path)?)
    }

    /// Private in-memory database; used by tests and as a fallback when the profile directory
    /// is not writable.
    pub fn open_in_memory() -> Result<Self, StoreError> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Self, StoreError> {
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    #[must_use]
    pub fn schema_version() -> u32 {
        u32::try_from(MIGRATIONS.len()).unwrap_or(u32::MAX)
    }

    fn migrate(&self) -> Result<(), StoreError> {
        let conn = self.conn.lock();
        let current: u32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        let target = Self::schema_version();
        if current > target {
            return Err(StoreError::Newer {
                found: current,
                supported: target,
            });
        }
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
            let next = u32::try_from(index + 1).unwrap_or(u32::MAX);
            tracing::info!(from = current, to = next, "applying database migration");
            conn.execute_batch(&format!(
                "BEGIN; {sql} PRAGMA user_version = {next}; COMMIT;"
            ))?;
        }
        Ok(())
    }

    pub fn user_version(&self) -> Result<u32, StoreError> {
        Ok(self
            .conn
            .lock()
            .pragma_query_value(None, "user_version", |row| row.get(0))?)
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, StoreError> {
        Ok(self
            .conn
            .lock()
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), StoreError> {
        self.conn.lock().execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Deletes a key; a no-op when it is not there.
    pub fn remove_meta(&self, key: &str) -> Result<(), StoreError> {
        self.conn
            .lock()
            .execute("DELETE FROM meta WHERE key = ?1", params![key])?;
        Ok(())
    }

    /// The value under `key`, created from `bytes` random bytes (lower-case hex) the first time
    /// it is asked for. One transaction, so two callers never mint two secrets.
    pub fn meta_or_random(&self, key: &str, bytes: u32) -> Result<String, StoreError> {
        let mut conn = self.conn.lock();
        let tx = conn.transaction()?;
        let existing: Option<String> = tx
            .query_row(
                "SELECT value FROM meta WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()?;
        let value = if let Some(value) = existing {
            value
        } else {
            let minted: String =
                tx.query_row("SELECT lower(hex(randomblob(?1)))", params![bytes], |row| {
                    row.get(0)
                })?;
            tx.execute(
                "INSERT INTO meta (key, value) VALUES (?1, ?2)",
                params![key, minted],
            )?;
            minted
        };
        tx.commit()?;
        Ok(value)
    }

    /// Appends one pomodoro phase to the log.
    pub fn log_pomodoro_session(&self, record: &PomodoroSessionRecord) -> Result<(), StoreError> {
        self.conn.lock().execute(
            "INSERT INTO pomodoro_sessions (phase, started_at, ended_at, completed) \
             VALUES (?1, ?2, ?3, ?4)",
            params![
                record.phase,
                record.started_at_ms,
                record.ended_at_ms,
                record.completed
            ],
        )?;
        Ok(())
    }

    /// Completed `work` phases that ended on the same local date as `now_ms` ("N sessions
    /// today"). The caller passes its clock's wall time rather than letting SQLite read the
    /// machine's, so the log and the count agree on what "today" is — under a fake clock as
    /// much as a real one. SQLite's `localtime` modifier does the zone conversion, so no
    /// date crate.
    pub fn pomodoro_sessions_today(&self, now_ms: i64) -> Result<u32, StoreError> {
        Ok(self.conn.lock().query_row(
            "SELECT COUNT(*) FROM pomodoro_sessions \
             WHERE phase = 'work' AND completed = 1 \
             AND date(ended_at / 1000, 'unixepoch', 'localtime') \
               = date(?1 / 1000, 'unixepoch', 'localtime')",
            params![now_ms],
            |row| row.get(0),
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_is_migrated_to_the_latest_version() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.user_version().unwrap(), Store::schema_version());
    }

    #[test]
    fn meta_upserts() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.get_meta("last_run").unwrap(), None);
        store.set_meta("last_run", "1").unwrap();
        store.set_meta("last_run", "2").unwrap();
        assert_eq!(store.get_meta("last_run").unwrap(), Some("2".into()));
        store.remove_meta("last_run").unwrap();
        store.remove_meta("never_there").unwrap();
        assert_eq!(store.get_meta("last_run").unwrap(), None);
    }

    #[test]
    fn a_random_meta_value_is_minted_once_and_kept() {
        let store = Store::open_in_memory().unwrap();
        let token = store.meta_or_random("token", 32).unwrap();
        assert_eq!(token.len(), 64);
        assert!(
            token
                .chars()
                .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase())
        );
        assert_eq!(store.meta_or_random("token", 32).unwrap(), token);
        assert_eq!(store.get_meta("token").unwrap(), Some(token.clone()));
        assert_ne!(store.meta_or_random("other", 32).unwrap(), token);
        store.set_meta("chosen", "abc").unwrap();
        assert_eq!(store.meta_or_random("chosen", 32).unwrap(), "abc");
    }

    #[test]
    fn reopening_a_file_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("muna.db");
        {
            let store = Store::open(&path).unwrap();
            store.set_meta("k", "v").unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.get_meta("k").unwrap(), Some("v".into()));
        assert_eq!(store.user_version().unwrap(), Store::schema_version());
    }

    #[test]
    fn newer_schema_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("muna.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.pragma_update(None, "user_version", 99).unwrap();
        }
        assert!(matches!(
            Store::open(&path).unwrap_err(),
            StoreError::Newer { found: 99, .. }
        ));
    }

    #[test]
    fn pomodoro_sessions_today_counts_completed_work_phases_only() {
        let store = Store::open_in_memory().unwrap();
        // A fixed moment (midday UTC), so the result does not depend on when the test runs.
        let now_ms: i64 = 1_772_366_400_000;
        let record = |phase: &str, ended_at_ms: i64, completed: bool| PomodoroSessionRecord {
            phase: phase.into(),
            started_at_ms: ended_at_ms - 1_500_000,
            ended_at_ms,
            completed,
        };
        store
            .log_pomodoro_session(&record("work", now_ms, true))
            .unwrap();
        store
            .log_pomodoro_session(&record("work", now_ms - 1000, false))
            .unwrap();
        store
            .log_pomodoro_session(&record("shortBreak", now_ms, true))
            .unwrap();
        // Two days ago is never "today" in any time zone.
        store
            .log_pomodoro_session(&record("work", now_ms - 48 * 3_600_000, true))
            .unwrap();
        assert_eq!(store.pomodoro_sessions_today(now_ms).unwrap(), 1);
        // "Today" is the caller's day, not the machine's: seen from two days later, nothing
        // ended today.
        assert_eq!(
            store
                .pomodoro_sessions_today(now_ms + 48 * 3_600_000)
                .unwrap(),
            0
        );
    }

    #[test]
    fn a_version_one_database_migrates_forward() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("muna.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(MIGRATIONS[0]).unwrap();
            conn.pragma_update(None, "user_version", 1).unwrap();
        }
        let store = Store::open(&path).unwrap();
        assert_eq!(store.user_version().unwrap(), Store::schema_version());
        assert_eq!(store.pomodoro_sessions_today(0).unwrap(), 0);
    }
}
