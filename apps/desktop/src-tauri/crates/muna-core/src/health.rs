//! Health storage (docs/modules/health.md): one row of counters per local day. Pure SQL over
//! [`Store`]; the module in the app crate owns the sitting timer, the flows and what "today"
//! means (it passes each day's start in Unix milliseconds).
//!
//! The counters are the only thing kept: no timestamps of individual breaks or glasses, and
//! nothing about what the user was doing — the rings and the weekday dots need no more.

use rusqlite::{OptionalExtension, Row, params};

use crate::store::{Store, StoreError};

/// One day's counters as stored. Every field is a running total for the day.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HealthDayRecord {
    /// The day's start in Unix milliseconds, the key.
    pub day_start_ms: i64,
    /// Time spent sitting at the desk (input activity, not idle, not locked).
    pub active_ms: i64,
    /// The longest uninterrupted sit.
    pub longest_sit_ms: i64,
    /// Breaks taken: natural (away for a while) or a guided Move/Stretch flow.
    pub breaks: u32,
    /// Glasses of water logged.
    pub water: u32,
    /// Seconds spent in the Breathe flow.
    pub mindful_seconds: u32,
    /// Guided flows finished, any kind.
    pub flows: u32,
}

const COLUMNS: &str = "day_start, active_ms, longest_sit_ms, breaks, water, mindful_seconds, flows";

fn count(row: &Row<'_>, index: usize) -> rusqlite::Result<u32> {
    let value: i64 = row.get(index)?;
    Ok(u32::try_from(value.max(0)).unwrap_or(u32::MAX))
}

fn from_row(row: &Row<'_>) -> rusqlite::Result<HealthDayRecord> {
    Ok(HealthDayRecord {
        day_start_ms: row.get(0)?,
        active_ms: row.get(1)?,
        longest_sit_ms: row.get(2)?,
        breaks: count(row, 3)?,
        water: count(row, 4)?,
        mindful_seconds: count(row, 5)?,
        flows: count(row, 6)?,
    })
}

impl Store {
    /// The row for the day starting at `day_start_ms`, if anything was recorded.
    pub fn health_day(&self, day_start_ms: i64) -> Result<Option<HealthDayRecord>, StoreError> {
        let conn = self.connection();
        Ok(conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM health_days WHERE day_start = ?1"),
                params![day_start_ms],
                from_row,
            )
            .optional()?)
    }

    /// Every recorded day with `from_ms <= day_start < to_ms`, oldest first.
    pub fn health_days_between(
        &self,
        from_ms: i64,
        to_ms: i64,
    ) -> Result<Vec<HealthDayRecord>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM health_days \
             WHERE day_start >= ?1 AND day_start < ?2 ORDER BY day_start"
        ))?;
        let days = statement
            .query_map(params![from_ms, to_ms], from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(days)
    }

    /// Writes a day's counters, replacing what was there.
    pub fn save_health_day(&self, record: &HealthDayRecord) -> Result<(), StoreError> {
        self.connection().execute(
            &format!(
                "INSERT INTO health_days ({COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT (day_start) DO UPDATE SET \
                    active_ms = excluded.active_ms, \
                    longest_sit_ms = excluded.longest_sit_ms, \
                    breaks = excluded.breaks, \
                    water = excluded.water, \
                    mindful_seconds = excluded.mindful_seconds, \
                    flows = excluded.flows"
            ),
            params![
                record.day_start_ms,
                record.active_ms,
                record.longest_sit_ms,
                record.breaks,
                record.water,
                record.mindful_seconds,
                record.flows,
            ],
        )?;
        Ok(())
    }

    /// Drops days that started before `before_ms` (retention). Returns how many went.
    pub fn prune_health_before(&self, before_ms: i64) -> Result<usize, StoreError> {
        Ok(self.connection().execute(
            "DELETE FROM health_days WHERE day_start < ?1",
            params![before_ms],
        )?)
    }

    /// Forgets every day (*Reset today* in the panel clears only today; this is the settings
    /// pane's *Clear history*).
    pub fn clear_health_days(&self) -> Result<(), StoreError> {
        self.connection().execute("DELETE FROM health_days", [])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: i64 = 24 * 60 * 60 * 1000;

    fn day(day_start_ms: i64, breaks: u32) -> HealthDayRecord {
        HealthDayRecord {
            day_start_ms,
            active_ms: 3_600_000,
            longest_sit_ms: 1_800_000,
            breaks,
            water: 3,
            mindful_seconds: 240,
            flows: 1,
        }
    }

    #[test]
    fn save_reads_back_and_replaces() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(store.health_day(0).unwrap(), None);
        store.save_health_day(&day(0, 2)).unwrap();
        assert_eq!(store.health_day(0).unwrap(), Some(day(0, 2)));
        store.save_health_day(&day(0, 5)).unwrap();
        assert_eq!(store.health_day(0).unwrap(), Some(day(0, 5)));
    }

    #[test]
    fn days_between_are_ordered_and_half_open() {
        let store = Store::open_in_memory().unwrap();
        for back in [3, 1, 0, 6, 8] {
            store
                .save_health_day(&day(10 * DAY_MS - back * DAY_MS, 1))
                .unwrap();
        }
        let week = store
            .health_days_between(10 * DAY_MS - 6 * DAY_MS, 10 * DAY_MS + DAY_MS)
            .unwrap();
        let starts: Vec<i64> = week.iter().map(|d| d.day_start_ms / DAY_MS).collect();
        assert_eq!(starts, vec![4, 7, 9, 10]);
    }

    #[test]
    fn prune_and_clear_forget_days() {
        let store = Store::open_in_memory().unwrap();
        store.save_health_day(&day(0, 1)).unwrap();
        store.save_health_day(&day(DAY_MS, 1)).unwrap();
        store.save_health_day(&day(2 * DAY_MS, 1)).unwrap();
        assert_eq!(store.prune_health_before(DAY_MS).unwrap(), 1);
        assert_eq!(store.health_days_between(0, 3 * DAY_MS).unwrap().len(), 2);
        store.clear_health_days().unwrap();
        assert!(store.health_days_between(0, 3 * DAY_MS).unwrap().is_empty());
    }
}
