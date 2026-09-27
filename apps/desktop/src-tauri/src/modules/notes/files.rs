//! The notes folder on disk (docs/modules/notes.md): plain `.md` files any editor can read,
//! Obsidian included. This layer knows paths, names and bytes; [`super::NotesService`] knows
//! pins, settings and the snapshot.
//!
//! A note's id is its path relative to the folder with `/` separators (`Inbox.md`,
//! `Projects/Muna.md`); its title is the file stem, as Obsidian shows it, so a rename is a file
//! rename and no heading is parsed or rewritten.

use std::fs::{self, File, Metadata};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

/// The only extension the folder scan lists.
pub const EXTENSION: &str = "md";
/// The note quick capture appends to, at the folder's root.
pub const INBOX_STEM: &str = "Inbox";
pub const INBOX_ID: &str = "Inbox.md";
/// The most notes one folder lists; a vault past this shows its newest and says so in the log.
pub const MAX_NOTES: usize = 2000;
/// Sub-folders deeper than this are not walked (a vault's attachments and archives).
pub const MAX_DEPTH: usize = 4;
/// The excerpt shown under a title in the list, in characters.
pub const EXCERPT_CHARS: usize = 160;
/// How much of a file the scan reads for its excerpt.
pub const HEAD_BYTES: u64 = 4096;
/// Notes the editor opens; bigger files are listed but sent to the default app instead.
pub const MAX_NOTE_BYTES: u64 = 2 * 1024 * 1024;
/// File stems longer than this are cut (a Windows path has 260 characters by default).
pub const MAX_STEM_CHARS: usize = 80;
/// What a blank title becomes.
pub const UNTITLED: &str = "Untitled";

/// One `.md` file the scan found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scanned {
    pub id: String,
    pub path: PathBuf,
    pub modified_ms: i64,
    pub bytes: u64,
}

/// Every `.md` file under `folder`, newest first, at most [`MAX_NOTES`]; sub-folders down to
/// [`MAX_DEPTH`], dot-folders (`.obsidian`, `.git`, `.trash`) and symlinks skipped.
pub fn scan(folder: &Path) -> io::Result<Vec<Scanned>> {
    let mut found = Vec::new();
    let mut pending = vec![(folder.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = pending.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with('.') {
                continue;
            }
            let file_type = entry.file_type()?;
            if file_type.is_dir() {
                if depth < MAX_DEPTH {
                    pending.push((entry.path(), depth + 1));
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some(EXTENSION) {
                continue;
            }
            let Some(id) = id_of(folder, &path) else {
                continue;
            };
            let meta = entry.metadata()?;
            found.push(Scanned {
                id,
                path,
                modified_ms: modified_ms(&meta),
                bytes: meta.len(),
            });
        }
    }
    found.sort_by(|a, b| {
        b.modified_ms
            .cmp(&a.modified_ms)
            .then_with(|| a.id.cmp(&b.id))
    });
    if found.len() > MAX_NOTES {
        tracing::warn!(
            total = found.len(),
            listed = MAX_NOTES,
            "notes folder has more files than the list shows"
        );
        found.truncate(MAX_NOTES);
    }
    Ok(found)
}

/// The id of `path` inside `folder`: the relative path with `/` separators.
#[must_use]
pub fn id_of(folder: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(folder).ok()?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_str()?.to_owned()),
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

/// The file behind an id, or `None` for anything that is not a plain relative `.md` path
/// inside `folder` (`..`, drive letters, other extensions): ids come from the webview.
#[must_use]
pub fn path_of(folder: &Path, id: &str) -> Option<PathBuf> {
    if id.is_empty() || id.len() > 1024 {
        return None;
    }
    let mut path = folder.to_path_buf();
    for part in id.split('/') {
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.contains(['\\', ':'])
            || part.chars().any(char::is_control)
        {
            return None;
        }
        path.push(part);
    }
    (path.extension().and_then(|ext| ext.to_str()) == Some(EXTENSION)).then_some(path)
}

/// The title of a note: its file stem.
#[must_use]
pub fn title_of(id: &str) -> String {
    let name = id.rsplit('/').next().unwrap_or(id);
    name.strip_suffix(".md").unwrap_or(name).to_owned()
}

/// The sub-folder a note sits in, relative to the notes folder; empty at the root.
#[must_use]
pub fn parent_of(id: &str) -> String {
    id.rsplit_once('/')
        .map_or_else(String::new, |(parent, _)| parent.to_owned())
}

/// Reads the head of a note and returns its excerpt: the first lines with words in them, list
/// and heading marks and emphasis stripped, up to [`EXCERPT_CHARS`] characters.
pub fn excerpt(path: &Path) -> io::Result<String> {
    let mut head = Vec::new();
    File::open(path)?.take(HEAD_BYTES).read_to_end(&mut head)?;
    Ok(excerpt_of(&String::from_utf8_lossy(&head)))
}

/// The excerpt of a body (see [`excerpt`]).
#[must_use]
pub fn excerpt_of(body: &str) -> String {
    let mut out = String::new();
    let mut truncated = false;
    for raw in body.lines() {
        let line = plain_line(raw);
        if line.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        for ch in line.chars() {
            if out.chars().count() >= EXCERPT_CHARS {
                truncated = true;
                break;
            }
            out.push(ch);
        }
        if truncated {
            break;
        }
    }
    if truncated {
        let trimmed = out.trim_end().to_owned();
        format!("{trimmed}…")
    } else {
        out
    }
}

/// One Markdown line as words: leading marks (`#`, `-`, `*`, `>`, `1.`, `- [ ]`), fences and
/// emphasis characters removed, whitespace collapsed.
fn plain_line(raw: &str) -> String {
    let mut line = raw.trim();
    if line.starts_with("```") || line.starts_with("---") || line.starts_with("***") {
        return String::new();
    }
    loop {
        let before = line;
        line = line
            .trim_start_matches(['#', '>', '-', '*', '+'])
            .trim_start();
        if let Some(rest) = line
            .strip_prefix("[ ]")
            .or_else(|| line.strip_prefix("[x]"))
        {
            line = rest.trim_start();
        }
        let digits = line.chars().take_while(char::is_ascii_digit).count();
        if digits > 0
            && let Some(rest) = line.get(digits..)
            && let Some(rest) = rest.strip_prefix('.').or_else(|| rest.strip_prefix(')'))
        {
            line = rest.trim_start();
        }
        if line == before {
            break;
        }
    }
    let mut out = String::new();
    let mut space = false;
    for ch in line.chars() {
        if matches!(ch, '*' | '_' | '`' | '~') {
            continue;
        }
        if ch.is_whitespace() {
            space = true;
            continue;
        }
        if space && !out.is_empty() {
            out.push(' ');
        }
        space = false;
        out.push(ch);
    }
    out
}

/// A file stem for a title: characters Windows refuses (`<>:"/\|?*` and controls) become
/// spaces, whitespace collapses, trailing dots and spaces go, reserved device names get a
/// suffix, the result is cut to [`MAX_STEM_CHARS`] and a blank title is [`UNTITLED`].
#[must_use]
pub fn stem_for(title: &str) -> String {
    let mut out = String::new();
    let mut space = false;
    for ch in title.chars() {
        let bad =
            matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || ch.is_control();
        if bad || ch.is_whitespace() {
            space = true;
            continue;
        }
        if space && !out.is_empty() {
            out.push(' ');
        }
        space = false;
        out.push(ch);
    }
    let mut stem: String = out.chars().take(MAX_STEM_CHARS).collect();
    while stem.ends_with(['.', ' ']) {
        stem.pop();
    }
    if stem.is_empty() {
        return UNTITLED.to_owned();
    }
    let upper = stem.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((upper.starts_with("COM") || upper.starts_with("LPT"))
            && upper.len() == 4
            && upper.ends_with(|c: char| c.is_ascii_digit()));
    if reserved {
        stem.push_str(" note");
    }
    stem
}

/// `Stem.md` in `dir`, or `Stem 2.md`, `Stem 3.md`, … when taken (any case: NTFS is
/// case-insensitive, so the check goes through the file system).
#[must_use]
pub fn unique_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{EXTENSION}"));
    if !first.exists() {
        return first;
    }
    // Bounded: a folder cannot hold more than u32::MAX same-stem files, and the loop stops at
    // the first free number long before that.
    (2..=u32::MAX)
        .map(|n| dir.join(format!("{stem} {n}.{EXTENSION}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or(first)
}

/// Reads a whole note for the editor with `\r\n` turned into `\n`, and its modified time —
/// the baseline a later save checks against.
pub fn read(path: &Path) -> io::Result<(String, i64)> {
    let meta = fs::metadata(path)?;
    if meta.len() > MAX_NOTE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::FileTooLarge,
            "the note is too large for the editor",
        ));
    }
    let bytes = fs::read(path)?;
    let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
    Ok((text, modified_ms(&meta)))
}

/// Writes `body` to `path` through a temporary file in the same folder and a rename, so a
/// crash mid-write leaves the old note whole; returns the new modified time. Creates
/// intermediate folders.
pub fn write(path: &Path, body: &str) -> io::Result<i64> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = temp_path(path);
    {
        let mut file = File::create(&tmp)?;
        file.write_all(body.as_bytes())?;
        file.sync_all()?;
    }
    if let Err(error) = fs::rename(&tmp, path) {
        let _ = fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(modified_ms(&fs::metadata(path)?))
}

fn temp_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("note");
    path.with_file_name(format!(".{name}.muna-tmp"))
}

/// Milliseconds since the Unix epoch of a file's modified time; `0` when the file system
/// does not say.
#[must_use]
pub fn modified_ms(meta: &Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_relative_paths_with_forward_slashes() {
        let folder = Path::new("C:\\notes");
        assert_eq!(
            id_of(folder, &folder.join("Inbox.md")).as_deref(),
            Some("Inbox.md")
        );
        assert_eq!(
            id_of(folder, &folder.join("Projects").join("Muna.md")).as_deref(),
            Some("Projects/Muna.md")
        );
        assert_eq!(id_of(folder, Path::new("D:\\other\\x.md")), None);
    }

    #[test]
    fn path_of_refuses_escapes_and_other_extensions() {
        let folder = Path::new("C:\\notes");
        assert_eq!(
            path_of(folder, "Projects/Muna.md"),
            Some(folder.join("Projects").join("Muna.md"))
        );
        assert_eq!(path_of(folder, "../secrets.md"), None);
        assert_eq!(path_of(folder, "a/../b.md"), None);
        assert_eq!(path_of(folder, "C:/x.md"), None);
        assert_eq!(path_of(folder, "..\\x.md"), None);
        assert_eq!(path_of(folder, "settings.json"), None);
        assert_eq!(path_of(folder, ""), None);
    }

    #[test]
    fn titles_and_parents_come_from_the_id() {
        assert_eq!(title_of("Inbox.md"), "Inbox");
        assert_eq!(title_of("Projects/Muna notes.md"), "Muna notes");
        assert_eq!(parent_of("Inbox.md"), "");
        assert_eq!(parent_of("Projects/2026/Muna.md"), "Projects/2026");
    }

    #[test]
    fn excerpts_strip_marks_and_stop_at_the_limit() {
        assert_eq!(
            excerpt_of("# Heading\n\n- [ ] buy **milk**\n1. call `Ann`\n> quoted"),
            "Heading buy milk call Ann quoted"
        );
        assert_eq!(excerpt_of("```\ncode\n```\n---\n"), "code");
        let long = "word ".repeat(100);
        let out = excerpt_of(&long);
        assert!(out.ends_with('…'));
        assert!(out.chars().count() <= EXCERPT_CHARS + 1);
        assert_eq!(excerpt_of("\n\n   \n"), "");
    }

    #[test]
    fn stems_are_safe_file_names() {
        assert_eq!(
            stem_for("  Meeting: notes / ideas?  "),
            "Meeting notes ideas"
        );
        assert_eq!(stem_for("Trailing dots..."), "Trailing dots");
        assert_eq!(stem_for(""), UNTITLED);
        // Only forbidden characters: nothing survives, so the note gets the fallback name.
        assert_eq!(stem_for("***"), UNTITLED);
        assert_eq!(stem_for("con"), "con note");
        assert_eq!(stem_for("COM1"), "COM1 note");
        assert_eq!(stem_for("COM10"), "COM10");
        assert_eq!(stem_for(&"x".repeat(200)).chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn writes_are_atomic_and_readable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Projects").join("Muna.md");
        let first = write(&path, "one\r\ntwo\n").unwrap();
        assert!(first > 0);
        let (body, modified) = read(&path).unwrap();
        assert_eq!(body, "one\ntwo\n");
        assert_eq!(modified, first);
        assert!(
            !dir.path()
                .join("Projects")
                .join(".Muna.md.muna-tmp")
                .exists()
        );
        write(&path, "three").unwrap();
        assert_eq!(read(&path).unwrap().0, "three");
    }

    #[test]
    fn unique_paths_count_up() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(unique_path(dir.path(), "Idea"), dir.path().join("Idea.md"));
        write(&dir.path().join("Idea.md"), "").unwrap();
        assert_eq!(
            unique_path(dir.path(), "Idea"),
            dir.path().join("Idea 2.md")
        );
        write(&dir.path().join("Idea 2.md"), "").unwrap();
        assert_eq!(
            unique_path(dir.path(), "Idea"),
            dir.path().join("Idea 3.md")
        );
    }

    #[test]
    fn scan_lists_markdown_only_and_skips_dot_folders() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("Inbox.md"), "a").unwrap();
        write(&dir.path().join("Projects").join("Muna.md"), "b").unwrap();
        write(&dir.path().join(".obsidian").join("Hidden.md"), "c").unwrap();
        fs::write(dir.path().join("image.png"), b"x").unwrap();
        fs::write(dir.path().join(".hidden.md"), b"x").unwrap();
        let mut ids: Vec<String> = scan(dir.path())
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();
        ids.sort();
        assert_eq!(ids, ["Inbox.md", "Projects/Muna.md"]);
    }

    #[test]
    fn scan_stops_at_the_depth_limit() {
        let dir = tempfile::tempdir().unwrap();
        let mut deep = dir.path().to_path_buf();
        for level in 0..=MAX_DEPTH {
            deep.push(format!("d{level}"));
        }
        write(&deep.join("Too deep.md"), "").unwrap();
        let mut ok = dir.path().to_path_buf();
        for level in 0..MAX_DEPTH {
            ok.push(format!("d{level}"));
        }
        write(&ok.join("Just fits.md"), "").unwrap();
        let ids: Vec<String> = scan(dir.path())
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids.len(), 1);
        assert!(ids[0].ends_with("Just fits.md"));
    }
}
