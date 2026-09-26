//! Shelf storage (docs/modules/shelf.md): the files and text snippets parked on the Shelf,
//! persisted so they survive a restart. Pure SQL over [`Store`]; the module in the app crate
//! owns the behaviour (copies into Shelf storage, thumbnails, expiry) and the time.
//!
//! Paths and text are content: they stay in Rust and are never logged. The module maps a
//! [`ShelfRecord`] to a wire type without them before the UI sees it.
//!
//! Times are Unix milliseconds. Items keep the order they arrived in (`sort_order` ascending).

use std::path::PathBuf;

use rusqlite::{Row, params};
use serde::{Deserialize, Serialize};
use specta::Type;

use crate::store::{Store, StoreError};

/// What an item is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum ShelfItemKind {
    /// A file or folder, by reference or as a copy in Shelf storage.
    File,
    /// A text snippet (a URL, a paragraph).
    Text,
}

impl ShelfItemKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::File => "file",
            Self::Text => "text",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "file" => Some(Self::File),
            "text" => Some(Self::Text),
            _ => None,
        }
    }
}

/// One item as stored. `path` is set for files, `text` for snippets; `copied` marks a path
/// inside Shelf storage (ours to delete with the item).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShelfRecord {
    pub id: String,
    pub kind: ShelfItemKind,
    /// The file name, or the first line of the snippet.
    pub name: String,
    pub path: Option<PathBuf>,
    pub text: Option<String>,
    /// Bytes, for files whose size was known when they arrived.
    pub size: Option<i64>,
    pub copied: bool,
    pub added_at_ms: i64,
    pub sort_order: i64,
}

/// What a new item needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewShelfItem {
    pub kind: ShelfItemKind,
    pub name: String,
    pub path: Option<PathBuf>,
    pub text: Option<String>,
    pub size: Option<i64>,
    pub copied: bool,
}

impl NewShelfItem {
    /// A file item referencing `path`.
    #[must_use]
    pub fn file(path: PathBuf, size: Option<i64>, copied: bool) -> Self {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| path.to_string_lossy().into_owned());
        Self {
            kind: ShelfItemKind::File,
            name,
            path: Some(path),
            text: None,
            size,
            copied,
        }
    }

    /// A text snippet; the name is its first non-empty line, cut to [`NAME_CHARS`] characters.
    #[must_use]
    pub fn text(text: String) -> Self {
        Self {
            kind: ShelfItemKind::Text,
            name: snippet_name(&text),
            path: None,
            text: Some(text),
            size: None,
            copied: false,
        }
    }
}

/// Most characters a snippet's name keeps.
pub const NAME_CHARS: usize = 60;

/// The first non-empty line of `text`, trimmed and cut to [`NAME_CHARS`] characters.
#[must_use]
pub fn snippet_name(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");
    let mut name: String = line.chars().take(NAME_CHARS).collect();
    if line.chars().count() > NAME_CHARS {
        name.truncate(name.trim_end().len());
        name.push('…');
    }
    name
}

/// What another module hands the Shelf (the Drop actions *Shelf* tile): files to park. Lives
/// here so both modules depend on the core only (ADR-0004: no cross-module imports).
pub trait ShelfIntake: Send + Sync {
    /// Adds `paths` to the Shelf; returns how many were new. Items already on the Shelf are
    /// left alone and not counted.
    fn add_files(&self, paths: &[PathBuf]) -> Result<usize, ShelfIntakeError>;
}

/// Why the Shelf refused an intake.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ShelfIntakeError {
    #[error("the Shelf could not store the items: {0}")]
    Store(String),
    #[error("the Shelf is off")]
    Disabled,
}

const COLUMNS: &str = "id, kind, name, path, text, size, copied, added_at, sort_order";

fn record_from_row(row: &Row<'_>) -> rusqlite::Result<ShelfRecord> {
    let kind: String = row.get(1)?;
    let kind = ShelfItemKind::parse(&kind).ok_or_else(|| {
        rusqlite::Error::FromSqlConversionFailure(
            1,
            rusqlite::types::Type::Text,
            format!("unknown shelf item kind {kind:?}").into(),
        )
    })?;
    let path: Option<String> = row.get(3)?;
    Ok(ShelfRecord {
        id: row.get(0)?,
        kind,
        name: row.get(2)?,
        path: path.map(PathBuf::from),
        text: row.get(4)?,
        size: row.get(5)?,
        copied: row.get(6)?,
        added_at_ms: row.get(7)?,
        sort_order: row.get(8)?,
    })
}

fn path_text(path: Option<&PathBuf>) -> Option<String> {
    path.map(|path| path.to_string_lossy().into_owned())
}

impl Store {
    /// Every item, oldest first.
    pub fn shelf_items(&self) -> Result<Vec<ShelfRecord>, StoreError> {
        let conn = self.connection();
        let mut statement = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM shelf_items ORDER BY sort_order, added_at, id"
        ))?;
        let items = statement
            .query_map([], record_from_row)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    /// The items with these ids, in Shelf order; unknown ids are skipped.
    pub fn shelf_items_by_id(&self, ids: &[String]) -> Result<Vec<ShelfRecord>, StoreError> {
        Ok(self
            .shelf_items()?
            .into_iter()
            .filter(|item| ids.contains(&item.id))
            .collect())
    }

    /// Appends `items`, skipping any whose path or text is already on the Shelf. Returns the
    /// records actually added, in order.
    pub fn insert_shelf_items(
        &self,
        items: &[NewShelfItem],
        now_ms: i64,
    ) -> Result<Vec<ShelfRecord>, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let mut added = Vec::new();
        for item in items {
            let duplicate: bool = match (item.kind, &item.path, &item.text) {
                (ShelfItemKind::File, Some(path), _) => {
                    tx.query_row(
                        "SELECT COUNT(*) FROM shelf_items WHERE kind = 'file' AND path = ?1",
                        params![path.to_string_lossy()],
                        |row| row.get::<_, i64>(0),
                    )? > 0
                }
                (ShelfItemKind::Text, _, Some(text)) => {
                    tx.query_row(
                        "SELECT COUNT(*) FROM shelf_items WHERE kind = 'text' AND text = ?1",
                        params![text],
                        |row| row.get::<_, i64>(0),
                    )? > 0
                }
                // A file without a path or a snippet without text has nothing to show.
                _ => true,
            };
            if duplicate {
                continue;
            }
            let id: String =
                tx.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
            tx.execute(
                "INSERT INTO shelf_items (id, kind, name, path, text, size, copied, added_at, \
                 sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, \
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM shelf_items))",
                params![
                    id,
                    item.kind.as_str(),
                    item.name,
                    path_text(item.path.as_ref()),
                    item.text,
                    item.size,
                    item.copied,
                    now_ms
                ],
            )?;
            added.push(tx.query_row(
                &format!("SELECT {COLUMNS} FROM shelf_items WHERE id = ?1"),
                params![id],
                record_from_row,
            )?);
        }
        tx.commit()?;
        Ok(added)
    }

    /// Removes these items and returns what was removed (the module deletes their copies).
    pub fn remove_shelf_items(&self, ids: &[String]) -> Result<Vec<ShelfRecord>, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let mut removed = Vec::new();
        for id in ids {
            let record = tx
                .query_row(
                    &format!("SELECT {COLUMNS} FROM shelf_items WHERE id = ?1"),
                    params![id],
                    record_from_row,
                )
                .ok();
            if let Some(record) = record {
                tx.execute("DELETE FROM shelf_items WHERE id = ?1", params![id])?;
                removed.push(record);
            }
        }
        tx.commit()?;
        Ok(removed)
    }

    /// Removes every item and returns them.
    pub fn clear_shelf(&self) -> Result<Vec<ShelfRecord>, StoreError> {
        let items = self.shelf_items()?;
        self.connection().execute("DELETE FROM shelf_items", [])?;
        Ok(items)
    }

    /// Removes every item added before `cutoff_ms` (the expiry setting) and returns them.
    pub fn expire_shelf_items(&self, cutoff_ms: i64) -> Result<Vec<ShelfRecord>, StoreError> {
        let mut conn = self.connection();
        let tx = conn.transaction()?;
        let expired = {
            let mut statement = tx.prepare(&format!(
                "SELECT {COLUMNS} FROM shelf_items WHERE added_at < ?1 \
                 ORDER BY sort_order, added_at, id"
            ))?;
            statement
                .query_map(params![cutoff_ms], record_from_row)?
                .collect::<Result<Vec<_>, _>>()?
        };
        tx.execute(
            "DELETE FROM shelf_items WHERE added_at < ?1",
            params![cutoff_ms],
        )?;
        tx.commit()?;
        Ok(expired)
    }

    /// How many items are on the Shelf.
    pub fn shelf_len(&self) -> Result<usize, StoreError> {
        let count: i64 =
            self.connection()
                .query_row("SELECT COUNT(*) FROM shelf_items", [], |row| row.get(0))?;
        Ok(usize::try_from(count).unwrap_or(0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    fn file(path: &str) -> NewShelfItem {
        NewShelfItem::file(PathBuf::from(path), Some(10), false)
    }

    #[test]
    fn items_keep_arrival_order_and_skip_duplicates() {
        let store = store();
        let first = store
            .insert_shelf_items(
                &[
                    file("C:\\docs\\a.txt"),
                    NewShelfItem::text("hello\nworld".into()),
                ],
                1_000,
            )
            .unwrap();
        assert_eq!(first.len(), 2);
        assert_eq!(first[0].name, "a.txt");
        assert_eq!(first[0].path, Some(PathBuf::from("C:\\docs\\a.txt")));
        assert_eq!(first[1].name, "hello");
        assert_eq!(first[1].text.as_deref(), Some("hello\nworld"));

        let second = store
            .insert_shelf_items(
                &[
                    file("C:\\docs\\a.txt"),
                    NewShelfItem::text("hello\nworld".into()),
                    file("C:\\docs\\b.txt"),
                ],
                2_000,
            )
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].name, "b.txt");

        let all = store.shelf_items().unwrap();
        assert_eq!(
            all.iter()
                .map(|item| item.name.as_str())
                .collect::<Vec<_>>(),
            ["a.txt", "hello", "b.txt"]
        );
        assert!(
            all.windows(2)
                .all(|pair| pair[0].sort_order < pair[1].sort_order)
        );
        assert_eq!(store.shelf_len().unwrap(), 3);
    }

    #[test]
    fn items_without_content_are_not_stored() {
        let store = store();
        let added = store
            .insert_shelf_items(
                &[
                    NewShelfItem {
                        kind: ShelfItemKind::File,
                        name: "x".into(),
                        path: None,
                        text: None,
                        size: None,
                        copied: false,
                    },
                    NewShelfItem {
                        kind: ShelfItemKind::Text,
                        name: String::new(),
                        path: None,
                        text: None,
                        size: None,
                        copied: false,
                    },
                ],
                1,
            )
            .unwrap();
        assert!(added.is_empty());
        assert_eq!(store.shelf_len().unwrap(), 0);
    }

    #[test]
    fn remove_clear_and_expire_return_what_went() {
        let store = store();
        store
            .insert_shelf_items(&[file("a"), file("b")], 1_000)
            .unwrap();
        store.insert_shelf_items(&[file("c")], 5_000).unwrap();
        let all = store.shelf_items().unwrap();

        let removed = store
            .remove_shelf_items(&[all[0].id.clone(), "missing".into()])
            .unwrap();
        assert_eq!(removed.len(), 1);
        assert_eq!(removed[0].name, "a");

        let by_id = store
            .shelf_items_by_id(&[all[2].id.clone(), all[1].id.clone()])
            .unwrap();
        assert_eq!(
            by_id.iter().map(|i| i.name.as_str()).collect::<Vec<_>>(),
            ["b", "c"]
        );

        let expired = store.expire_shelf_items(2_000).unwrap();
        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].name, "b");
        assert_eq!(store.shelf_len().unwrap(), 1);

        let cleared = store.clear_shelf().unwrap();
        assert_eq!(cleared.len(), 1);
        assert_eq!(cleared[0].name, "c");
        assert!(store.shelf_items().unwrap().is_empty());
    }

    #[test]
    fn copies_and_sizes_round_trip() {
        let store = store();
        let added = store
            .insert_shelf_items(
                &[NewShelfItem::file(
                    PathBuf::from("C:\\Users\\me\\AppData\\Local\\Muna\\shelf\\1\\big.iso"),
                    Some(4_000_000_000),
                    true,
                )],
                7,
            )
            .unwrap();
        let item = &added[0];
        assert!(item.copied);
        assert_eq!(item.size, Some(4_000_000_000));
        assert_eq!(item.added_at_ms, 7);
        assert_eq!(item.kind, ShelfItemKind::File);
        assert_eq!(item.name, "big.iso");
    }

    #[test]
    fn snippet_names_are_the_first_line_cut_short() {
        assert_eq!(
            snippet_name("\n\n  https://example.com  \nmore"),
            "https://example.com"
        );
        assert_eq!(snippet_name("   "), "");
        let long = "x".repeat(NAME_CHARS + 5);
        let name = snippet_name(&long);
        assert_eq!(name.chars().count(), NAME_CHARS + 1);
        assert!(name.ends_with('…'));
        let exact = "y".repeat(NAME_CHARS);
        assert_eq!(snippet_name(&exact), exact);
        let words = "word ".repeat(30);
        let name = snippet_name(&words);
        assert!(
            name.ends_with("word…"),
            "no space before the ellipsis: {name:?}"
        );
    }

    #[test]
    fn a_file_item_is_named_after_its_last_segment() {
        assert_eq!(file("C:\\a\\b\\report.pdf").name, "report.pdf");
        assert_eq!(file("C:\\a\\folder\\").name, "folder");
        assert_eq!(file("C:\\").name, "C:\\");
    }
}
