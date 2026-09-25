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

    /// Completed `work` phases that ended today in the machine's local time zone ("N sessions
    /// today"). SQLite's `localtime` modifier does the zone conversion, so no date crate.
    pub fn pomodoro_sessions_today(&self) -> Result<u32, StoreError> {
        Ok(self.conn.lock().query_row(
            "SELECT COUNT(*) FROM pomodoro_sessions \
             WHERE phase = 'work' AND completed = 1 \
             AND date(ended_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')",
            [],
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
        let now_ms = i64::try_from(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis(),
        )
        .unwrap();
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
        assert_eq!(store.pomodoro_sessions_today().unwrap(), 1);
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
        assert_eq!(store.pomodoro_sessions_today().unwrap(), 0);
    }
}
