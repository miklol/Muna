//! On-disk artwork cache (`%LOCALAPPDATA%\Muna\cache\art\<key>.json`): one prepared
//! [`Artwork`] per key, evicted oldest-first past a fixed count. Everything is best effort — a
//! cache that cannot be written just costs a decode.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::Artwork;

#[derive(Debug, Clone)]
pub struct ArtCache {
    dir: PathBuf,
    max_entries: usize,
}

impl ArtCache {
    /// `max_entries` is the number of tracks kept; pass-through art runs 100–320 KB each.
    #[must_use]
    pub fn new(dir: impl Into<PathBuf>, max_entries: usize) -> Self {
        Self {
            dir: dir.into(),
            max_entries: max_entries.max(1),
        }
    }

    #[must_use]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn path(&self, key: &str) -> PathBuf {
        // Keys are hex; anything else stays out of the file name.
        let safe: String = key
            .chars()
            .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
            .collect();
        self.dir.join(format!("{safe}.json"))
    }

    /// The cached artwork, or `None` when missing or unreadable (a corrupt entry is removed).
    #[must_use]
    pub fn get(&self, key: &str) -> Option<Artwork> {
        let path = self.path(key);
        let text = fs::read_to_string(&path).ok()?;
        match serde_json::from_str::<Artwork>(&text) {
            Ok(art) if art.key == key => {
                // Touch so eviction sees recent use; failure only affects eviction order.
                let _ = touch(&path, SystemTime::now());
                Some(art)
            }
            _ => {
                let _ = fs::remove_file(&path);
                None
            }
        }
    }

    /// Stores `art` and evicts the oldest entries past `max_entries`.
    pub fn put(&self, art: &Artwork) -> std::io::Result<()> {
        fs::create_dir_all(&self.dir)?;
        let path = self.path(&art.key);
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec(art)?)?;
        fs::rename(&tmp, &path)?;
        self.evict();
        Ok(())
    }

    /// Number of entries on disk.
    #[must_use]
    pub fn len(&self) -> usize {
        self.entries().len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    fn entries(&self) -> Vec<(PathBuf, SystemTime)> {
        let Ok(read) = fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        read.filter_map(Result::ok)
            .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "json"))
            .map(|entry| {
                let modified = entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                (entry.path(), modified)
            })
            .collect()
    }

    fn evict(&self) {
        let mut entries = self.entries();
        if entries.len() <= self.max_entries {
            return;
        }
        entries.sort_by(|a, b| a.1.cmp(&b.1).then_with(|| a.0.cmp(&b.0)));
        let excess = entries.len() - self.max_entries;
        for (path, _) in entries.into_iter().take(excess) {
            let _ = fs::remove_file(path);
        }
    }
}

/// Sets the modification time; needs write access on Windows.
fn touch(path: &Path, when: SystemTime) -> std::io::Result<()> {
    fs::OpenOptions::new()
        .write(true)
        .open(path)?
        .set_modified(when)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn art(key: &str) -> Artwork {
        Artwork {
            key: key.into(),
            src: "data:image/png;base64,AA==".into(),
            palette: vec!["#000000".into(), "#000000".into(), "#000000".into()],
            width: 1,
            height: 1,
        }
    }

    #[test]
    fn put_then_get_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path().join("art"), 10);
        assert!(cache.is_empty());
        assert_eq!(cache.get("abc"), None);
        cache.put(&art("abc")).unwrap();
        assert_eq!(cache.get("abc"), Some(art("abc")));
        assert_eq!(cache.len(), 1);
    }

    #[test]
    fn eviction_removes_the_oldest_entries() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path(), 2);
        for key in ["a", "b", "c"] {
            cache.put(&art(key)).unwrap();
            // Distinct mtimes on file systems with coarse timestamps.
            let when = SystemTime::UNIX_EPOCH
                + std::time::Duration::from_secs(1_700_000_000 + u64::from(key.as_bytes()[0]));
            touch(&cache.path(key), when).unwrap();
            cache.evict();
        }
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.get("a"), None);
        assert!(cache.get("b").is_some());
        assert!(cache.get("c").is_some());
    }

    #[test]
    fn corrupt_or_mismatched_entries_are_dropped() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ArtCache::new(dir.path(), 5);
        fs::write(cache.path("bad"), b"{not json").unwrap();
        assert_eq!(cache.get("bad"), None);
        assert!(!cache.path("bad").exists());

        cache.put(&art("other")).unwrap();
        fs::copy(cache.path("other"), cache.path("renamed")).unwrap();
        assert_eq!(cache.get("renamed"), None);
    }

    #[test]
    fn keys_are_sanitised_into_file_names() {
        let cache = ArtCache::new("x", 1);
        assert_eq!(
            cache.path("../etc/passwd").file_name().unwrap(),
            "etcpasswd.json"
        );
    }
}
