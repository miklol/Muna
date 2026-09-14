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
const MIGRATIONS: &[&str] = &["CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);"];

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
}
