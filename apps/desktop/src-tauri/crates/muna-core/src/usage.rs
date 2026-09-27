//! Screen-time storage (docs/modules/screen-time.md): which executables held the foreground
//! and for how long. Pure SQL over [`Store`]; the module in the app crate owns attribution
//! (idle, lock, day boundaries), the category rules and the time.
//!
//! An app is keyed by its lower-case executable file name (`code.exe`) so it survives updates
//! and reinstalls; the last full path is kept for the icon. The user's choices — a category
//! override, *Exclude this app*, a daily limit — live on the app row and outlive the history.
//! Window titles are never stored. Times are Unix milliseconds.

use std::path::PathBuf;

use rusqlite::{OptionalExtension, Row, params};

use crate::store::{Store, StoreError};

/// One executable as stored, with the user's choices for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageApp {
    /// Lower-case executable file name, the key.
    pub exe: String,
    /// Display name: the executable's `FileDescription`, or a name derived from `exe`.
    pub name: String,
    /// Where the executable was last seen; the icon is read from here.
    pub path: PathBuf,
    /// The user's category override; `None` leaves it to the module's rule table.
    pub category: Option<String>,
    /// Excluded apps are never recorded and their history is gone.
    pub excluded: bool,
    /// Daily limit; `None` for no limit.
    pub limit_minutes: Option<u32>,
    pub first_seen_ms: i64,
    pub last_seen_ms: i64,
}

/// One foreground span. The open session is stored with `ended_at_ms` at its last flush and
/// moved forward by [`Store::record_usage_session`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageSession {
    pub id: i64,
    pub exe: String,
    pub started_at_ms: i64,
    pub ended_at_ms: i64,
}

/// What a sighting of an executable carries: enough to create or refresh its app row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppSighting<'a> {
    pub exe: &'a str,
    pub name: &'a str,
    pub path: &'a str,
}

const APP_COLUMNS: &str =
    "exe, name, path, category, excluded, limit_minutes, first_seen, last_seen";
const SESSION_COLUMNS: &str = "id, exe, started_at, ended_at";

fn app_from_row(row: &Row<'_>) -> rusqlite::Result<UsageApp> {
    let path: String = row.get(2)?;
    let limit: Option<i64> = row.get(5)?;
    Ok(UsageApp {
        exe: row.get(0)?,
        name: row.get(1)?,
        path: PathBuf::from(path),
        category: row.get(3)?,
        excluded: row.get(4)?,
        limit_minutes: limit.and_then(|minutes| u32::try_from(minutes).ok()),
        first_seen_ms: row.get(6)?,
        last_seen_ms: row.get(7)?,
    })
}

fn session_from_row(row: &Row<'_>) -> rusqlite::Result<UsageSession> {
    Ok(UsageSession {
        id: row.get(0)?,
        exe: row.get(1)?,
        started_at_ms: row.get(2)?,
        ended_at_ms: row.get(3)?,
    })
}

impl Store {
    /// Every known app, by name then key.
    pub fn usage_apps(&self) -> Result<Vec<UsageApp>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {APP_COLUMNS} FROM usage_apps ORDER BY lower(name), exe"
        ))?;
        let apps = statement
            .query_map([], app_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(apps)
    }

    /// One app by key.
    pub fn usage_app(&self, exe: &str) -> Result<Option<UsageApp>, StoreError> {
        let conn = self.connection();
        Ok(conn
            .query_row(
                &format!("SELECT {APP_COLUMNS} FROM usage_apps WHERE exe = ?1"),
                params![exe],
                app_from_row,
            )
            .optional()?)
    }

    /// Records a sighting: creates the app row or refreshes its name, path and `last_seen`,
    /// keeping the user's choices. Returns the row as it now stands.
    pub fn see_usage_app(
        &self,
        sighting: &AppSighting<'_>,
        now_ms: i64,
    ) -> Result<UsageApp, StoreError> {
        let conn = self.connection();
        // `excluded.` is SQLite's upsert alias for the row that would have been inserted; the
        // `excluded` column is untouched here.
        conn.execute(
            "INSERT INTO usage_apps (exe, name, path, first_seen, last_seen) \
             VALUES (?1, ?2, ?3, ?4, ?4) \
             ON CONFLICT (exe) DO UPDATE SET \
                name = CASE WHEN excluded.name = '' THEN usage_apps.name ELSE excluded.name END, \
                path = CASE WHEN excluded.path = '' THEN usage_apps.path ELSE excluded.path END, \
                last_seen = max(usage_apps.last_seen, excluded.last_seen)",
            params![sighting.exe, sighting.name, sighting.path, now_ms],
        )?;
        Ok(conn.query_row(
            &format!("SELECT {APP_COLUMNS} FROM usage_apps WHERE exe = ?1"),
            params![sighting.exe],
            app_from_row,
        )?)
    }

    /// Sets or clears the category override; `false` when the app is unknown.
    pub fn set_usage_app_category(
        &self,
        exe: &str,
        category: Option<&str>,
    ) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE usage_apps SET category = ?2 WHERE exe = ?1",
            params![exe, category],
        )?;
        Ok(changed > 0)
    }

    /// Sets or clears the daily limit; `false` when the app is unknown.
    pub fn set_usage_app_limit(
        &self,
        exe: &str,
        limit_minutes: Option<u32>,
    ) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE usage_apps SET limit_minutes = ?2 WHERE exe = ?1",
            params![exe, limit_minutes],
        )?;
        Ok(changed > 0)
    }

    /// Excludes an app: its sessions are deleted and nothing more is recorded for it.
    /// `false` when the app is unknown.
    pub fn exclude_usage_app(&self, exe: &str) -> Result<bool, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let changed = tx.execute(
            "UPDATE usage_apps SET excluded = 1 WHERE exe = ?1",
            params![exe],
        )?;
        tx.execute("DELETE FROM usage_sessions WHERE exe = ?1", params![exe])?;
        tx.commit()?;
        Ok(changed > 0)
    }

    /// Includes an app again (recording resumes from now); `false` when the app is unknown.
    pub fn include_usage_app(&self, exe: &str) -> Result<bool, StoreError> {
        let changed = self.connection().execute(
            "UPDATE usage_apps SET excluded = 0 WHERE exe = ?1",
            params![exe],
        )?;
        Ok(changed > 0)
    }

    /// Inserts a session, or moves the end of the one with `id` forward. Returns the row id.
    /// The app row must exist ([`Store::see_usage_app`]).
    pub fn record_usage_session(
        &self,
        id: Option<i64>,
        exe: &str,
        started_at_ms: i64,
        ended_at_ms: i64,
    ) -> Result<i64, StoreError> {
        let conn = self.connection();
        if let Some(id) = id {
            let changed = conn.execute(
                "UPDATE usage_sessions SET started_at = ?2, ended_at = ?3 WHERE id = ?1",
                params![id, started_at_ms, ended_at_ms],
            )?;
            if changed > 0 {
                return Ok(id);
            }
        }
        conn.execute(
            "INSERT INTO usage_sessions (exe, started_at, ended_at) VALUES (?1, ?2, ?3)",
            params![exe, started_at_ms, ended_at_ms],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Deletes one session (a span that turned out too short to keep).
    pub fn delete_usage_session(&self, id: i64) -> Result<(), StoreError> {
        self.connection()
            .execute("DELETE FROM usage_sessions WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Every session overlapping `[from_ms, to_ms)`, oldest first. Spans are not clipped;
    /// the caller clips to its window.
    pub fn usage_sessions_between(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<UsageSession>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {SESSION_COLUMNS} FROM usage_sessions \
             WHERE started_at < ?2 AND ended_at > ?1 ORDER BY started_at, id"
        ))?;
        let sessions = statement
            .query_map(params![from_ms, to_ms], session_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(sessions)
    }

    /// Drops sessions that ended before `cutoff_ms` (retention) and app rows nobody would miss:
    /// not seen since the cutoff and carrying no user choice. Returns how many sessions went.
    pub fn prune_usage_before(&self, cutoff_ms: i64) -> Result<usize, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let sessions = tx.execute(
            "DELETE FROM usage_sessions WHERE ended_at < ?1",
            params![cutoff_ms],
        )?;
        tx.execute(
            "DELETE FROM usage_apps WHERE last_seen < ?1 AND excluded = 0 \
             AND category IS NULL AND limit_minutes IS NULL \
             AND NOT EXISTS (SELECT 1 FROM usage_sessions WHERE usage_sessions.exe = usage_apps.exe)",
            params![cutoff_ms],
        )?;
        tx.commit()?;
        Ok(sessions)
    }

    /// Forgets the history: every session, and every app row without a user choice (the
    /// exclusions, categories and limits the user set are kept).
    pub fn clear_usage(&self) -> Result<(), StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        tx.execute("DELETE FROM usage_sessions", [])?;
        tx.execute(
            "DELETE FROM usage_apps WHERE excluded = 0 AND category IS NULL AND limit_minutes IS NULL",
            [],
        )?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOON: i64 = 1_772_366_400_000;
    const MINUTE: i64 = 60_000;

    fn code() -> AppSighting<'static> {
        AppSighting {
            exe: "code.exe",
            name: "Visual Studio Code",
            path: r"C:\Program Files\Microsoft VS Code\Code.exe",
        }
    }

    fn game() -> AppSighting<'static> {
        AppSighting {
            exe: "game.exe",
            name: "Game",
            path: r"C:\Games\game.exe",
        }
    }

    #[test]
    fn seeing_an_app_creates_it_then_refreshes_it_without_losing_choices() {
        let store = Store::open_in_memory().unwrap();
        let first = store.see_usage_app(&code(), NOON).unwrap();
        assert_eq!(first.name, "Visual Studio Code");
        assert_eq!(first.first_seen_ms, NOON);
        assert_eq!(first.last_seen_ms, NOON);
        assert!(!first.excluded);
        assert_eq!(first.category, None);

        assert!(
            store
                .set_usage_app_category("code.exe", Some("development"))
                .unwrap()
        );
        assert!(store.set_usage_app_limit("code.exe", Some(120)).unwrap());

        let moved = AppSighting {
            exe: "code.exe",
            name: "",
            path: r"D:\Tools\Code.exe",
        };
        let second = store.see_usage_app(&moved, NOON + MINUTE).unwrap();
        assert_eq!(
            second.name, "Visual Studio Code",
            "a blank name keeps the old one"
        );
        assert_eq!(second.path, PathBuf::from(r"D:\Tools\Code.exe"));
        assert_eq!(second.first_seen_ms, NOON);
        assert_eq!(second.last_seen_ms, NOON + MINUTE);
        assert_eq!(second.category.as_deref(), Some("development"));
        assert_eq!(second.limit_minutes, Some(120));

        assert!(!store.set_usage_app_limit("nope.exe", None).unwrap());
        assert_eq!(store.usage_app("nope.exe").unwrap(), None);
        assert_eq!(store.usage_app("code.exe").unwrap(), Some(second));
    }

    #[test]
    fn sessions_are_inserted_moved_forward_and_queried_by_overlap() {
        let store = Store::open_in_memory().unwrap();
        store.see_usage_app(&code(), NOON).unwrap();
        store.see_usage_app(&game(), NOON).unwrap();

        let open = store
            .record_usage_session(None, "code.exe", NOON, NOON + MINUTE)
            .unwrap();
        let same = store
            .record_usage_session(Some(open), "code.exe", NOON, NOON + 5 * MINUTE)
            .unwrap();
        assert_eq!(same, open, "a flush moves the same row");
        let later = store
            .record_usage_session(None, "game.exe", NOON + 10 * MINUTE, NOON + 20 * MINUTE)
            .unwrap();
        assert_ne!(later, open);
        let stale = store
            .record_usage_session(
                Some(999),
                "game.exe",
                NOON + 30 * MINUTE,
                NOON + 31 * MINUTE,
            )
            .unwrap();
        assert_ne!(stale, 999, "an unknown id inserts instead of vanishing");

        let all = store.usage_sessions_between(i64::MIN, i64::MAX).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].exe, "code.exe");
        assert_eq!(all[0].ended_at_ms, NOON + 5 * MINUTE);

        // Overlap, not containment: a window inside the first session still finds it.
        let inside = store
            .usage_sessions_between(NOON + MINUTE, NOON + 2 * MINUTE)
            .unwrap();
        assert_eq!(inside.len(), 1);
        assert_eq!(inside[0].id, open);
        // Half-open: a window starting exactly at an end does not include it.
        let after = store
            .usage_sessions_between(NOON + 5 * MINUTE, NOON + 10 * MINUTE)
            .unwrap();
        assert!(after.is_empty());

        store.delete_usage_session(open).unwrap();
        assert_eq!(
            store
                .usage_sessions_between(i64::MIN, i64::MAX)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn excluding_forgets_the_history_and_including_keeps_the_row() {
        let store = Store::open_in_memory().unwrap();
        store.see_usage_app(&game(), NOON).unwrap();
        store
            .record_usage_session(None, "game.exe", NOON, NOON + MINUTE)
            .unwrap();
        assert!(store.exclude_usage_app("game.exe").unwrap());
        assert!(store.usage_app("game.exe").unwrap().unwrap().excluded);
        assert!(
            store
                .usage_sessions_between(i64::MIN, i64::MAX)
                .unwrap()
                .is_empty()
        );
        assert!(store.include_usage_app("game.exe").unwrap());
        assert!(!store.usage_app("game.exe").unwrap().unwrap().excluded);
        assert!(!store.exclude_usage_app("nope.exe").unwrap());
    }

    #[test]
    fn pruning_and_clearing_keep_the_users_choices() {
        let store = Store::open_in_memory().unwrap();
        store.see_usage_app(&code(), NOON - 100 * MINUTE).unwrap();
        store.see_usage_app(&game(), NOON - 100 * MINUTE).unwrap();
        store
            .record_usage_session(None, "code.exe", NOON - 100 * MINUTE, NOON - 90 * MINUTE)
            .unwrap();
        store
            .record_usage_session(None, "game.exe", NOON - 100 * MINUTE, NOON - 90 * MINUTE)
            .unwrap();
        store
            .record_usage_session(None, "game.exe", NOON - 5 * MINUTE, NOON)
            .unwrap();
        store.set_usage_app_limit("code.exe", Some(60)).unwrap();

        let pruned = store.prune_usage_before(NOON - 10 * MINUTE).unwrap();
        assert_eq!(pruned, 2);
        let apps = store.usage_apps().unwrap();
        assert_eq!(
            apps.iter().map(|app| app.exe.as_str()).collect::<Vec<_>>(),
            vec!["game.exe", "code.exe"],
            "code.exe stays for its limit, game.exe for its recent session (sorted by name)"
        );

        store.see_usage_app(&game(), NOON).unwrap();
        store.exclude_usage_app("game.exe").unwrap();
        store.include_usage_app("game.exe").unwrap();
        store
            .record_usage_session(None, "game.exe", NOON, NOON + MINUTE)
            .unwrap();
        store.clear_usage().unwrap();
        assert!(
            store
                .usage_sessions_between(i64::MIN, i64::MAX)
                .unwrap()
                .is_empty()
        );
        let left = store.usage_apps().unwrap();
        assert_eq!(
            left.len(),
            1,
            "only the app with a limit survives: {left:?}"
        );
        assert_eq!(left[0].exe, "code.exe");
    }

    #[test]
    fn apps_are_listed_by_name() {
        let store = Store::open_in_memory().unwrap();
        store.see_usage_app(&game(), NOON).unwrap();
        store.see_usage_app(&code(), NOON).unwrap();
        store
            .see_usage_app(
                &AppSighting {
                    exe: "z.exe",
                    name: "alpha",
                    path: r"C:\z.exe",
                },
                NOON,
            )
            .unwrap();
        let names: Vec<String> = store
            .usage_apps()
            .unwrap()
            .into_iter()
            .map(|app| app.name)
            .collect();
        assert_eq!(names, vec!["alpha", "Game", "Visual Studio Code"]);
    }
}
