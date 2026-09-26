//! Zip and unzip for the drop tiles (docs/modules/drop-actions.md "Tiles": `zip` crate,
//! streaming, progress notice). Pure std + `zip`, so it runs under `cargo test` on a temp
//! folder. Paths are content and are never logged.
//!
//! Both directions stream through a small buffer, report progress in whole percent as bytes go
//! by, and stop at the next buffer when `cancel` is raised. Names are written relative to the
//! item's parent, so a dropped folder unpacks as that folder; extraction refuses entries that
//! would escape the destination (`enclosed_name`).

use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Files this large need ZIP64 headers.
const ZIP64_THRESHOLD: u64 = 0xFFFF_FFFF;
const BUFFER: usize = 64 * 1024;
/// The name of an archive made from several items.
const MULTI_ARCHIVE_STEM: &str = "Archive";

#[derive(Debug, thiserror::Error)]
pub enum ArchiveError {
    #[error("nothing to archive")]
    Empty,
    #[error("not a zip archive")]
    NotAnArchive,
    #[error("cancelled")]
    Cancelled,
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Zip(#[from] zip::result::ZipError),
}

/// Whether `path` names something *Unzip* can open.
#[must_use]
pub fn is_archive(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
}

/// Streams the bytes read so far into whole percentages, calling `report` on each change.
struct Progress<'a> {
    total: u64,
    done: u64,
    percent: u8,
    report: &'a mut dyn FnMut(u8),
}

impl<'a> Progress<'a> {
    fn new(total: u64, report: &'a mut dyn FnMut(u8)) -> Self {
        Self {
            total,
            done: 0,
            percent: 0,
            report,
        }
    }

    fn advance(&mut self, bytes: u64) {
        self.done = self.done.saturating_add(bytes);
        let percent = (self.done.min(self.total) * 100)
            .checked_div(self.total)
            .map_or(100, |percent| u8::try_from(percent).unwrap_or(100));
        if percent != self.percent {
            self.percent = percent;
            (self.report)(percent);
        }
    }
}

/// Zips `items` (files and folders) into a new archive beside the first one and returns its
/// path: `<stem>.zip` for a single item, `Archive.zip` for several, never overwriting.
pub fn zip(
    items: &[PathBuf],
    cancel: &AtomicBool,
    report: &mut dyn FnMut(u8),
) -> Result<PathBuf, ArchiveError> {
    let first = items.first().ok_or(ArchiveError::Empty)?;
    let parent = first
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let stem = if items.len() == 1 {
        first.file_stem().map_or_else(
            || MULTI_ARCHIVE_STEM.to_owned(),
            |s| s.to_string_lossy().into_owned(),
        )
    } else {
        MULTI_ARCHIVE_STEM.to_owned()
    };
    let destination = unique_path(&parent, &stem, "zip");

    let entries = collect_entries(items)?;
    let total = entries.iter().map(|entry| entry.size).sum();
    let mut progress = Progress::new(total, report);
    let mut writer = ZipWriter::new(File::create(&destination)?);
    let result = write_entries(&mut writer, &entries, cancel, &mut progress);
    let finished = result.and_then(|()| writer.finish().map(drop).map_err(ArchiveError::from));
    if let Err(error) = finished {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok(destination)
}

/// Unzips `archive` into a new folder beside it named after the archive and returns that
/// folder. Entries that would land outside it are skipped.
pub fn unzip(
    archive: &Path,
    cancel: &AtomicBool,
    report: &mut dyn FnMut(u8),
) -> Result<PathBuf, ArchiveError> {
    if !is_archive(archive) {
        return Err(ArchiveError::NotAnArchive);
    }
    let parent = archive
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map_or_else(|| PathBuf::from("."), Path::to_path_buf);
    let stem = archive.file_stem().map_or_else(
        || MULTI_ARCHIVE_STEM.to_owned(),
        |s| s.to_string_lossy().into_owned(),
    );
    let mut reader = ZipArchive::new(File::open(archive)?)?;
    let total = (0..reader.len())
        .map(|index| reader.by_index_raw(index).map(|entry| entry.size()))
        .sum::<Result<u64, _>>()?;
    let destination = unique_path(&parent, &stem, "");
    fs::create_dir_all(&destination)?;

    let mut progress = Progress::new(total, report);
    let result = extract_entries(&mut reader, &destination, cancel, &mut progress);
    if let Err(error) = result {
        let _ = fs::remove_dir_all(&destination);
        return Err(error);
    }
    Ok(destination)
}

/// One thing to write: a directory marker or a file with its size.
struct Entry {
    name: String,
    source: Option<PathBuf>,
    size: u64,
}

/// Walks `items` depth-first; names are relative to each item's parent, `/`-separated.
fn collect_entries(items: &[PathBuf]) -> Result<Vec<Entry>, ArchiveError> {
    let mut entries = Vec::new();
    for item in items {
        let name = item
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .ok_or(ArchiveError::Empty)?;
        walk(item, &name, &mut entries)?;
    }
    if entries.is_empty() {
        return Err(ArchiveError::Empty);
    }
    Ok(entries)
}

fn walk(path: &Path, name: &str, entries: &mut Vec<Entry>) -> Result<(), ArchiveError> {
    let metadata = fs::metadata(path)?;
    if metadata.is_dir() {
        entries.push(Entry {
            name: format!("{name}/"),
            source: None,
            size: 0,
        });
        let mut children: Vec<_> = fs::read_dir(path)?.collect::<Result<_, _>>()?;
        children.sort_by_key(std::fs::DirEntry::file_name);
        for child in children {
            let child_name = format!("{name}/{}", child.file_name().to_string_lossy());
            walk(&child.path(), &child_name, entries)?;
        }
    } else {
        entries.push(Entry {
            name: name.to_owned(),
            source: Some(path.to_path_buf()),
            size: metadata.len(),
        });
    }
    Ok(())
}

fn write_entries(
    writer: &mut ZipWriter<File>,
    entries: &[Entry],
    cancel: &AtomicBool,
    progress: &mut Progress<'_>,
) -> Result<(), ArchiveError> {
    let mut buffer = vec![0_u8; BUFFER];
    for entry in entries {
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .large_file(entry.size >= ZIP64_THRESHOLD);
        match &entry.source {
            None => writer.add_directory(&entry.name, options)?,
            Some(source) => {
                writer.start_file(&entry.name, options)?;
                let mut file = File::open(source)?;
                copy(&mut file, writer, &mut buffer, cancel, progress)?;
            }
        }
    }
    Ok(())
}

fn extract_entries(
    reader: &mut ZipArchive<File>,
    destination: &Path,
    cancel: &AtomicBool,
    progress: &mut Progress<'_>,
) -> Result<(), ArchiveError> {
    let mut buffer = vec![0_u8; BUFFER];
    for index in 0..reader.len() {
        let mut entry = reader.by_index(index)?;
        let Some(relative) = entry.enclosed_name() else {
            tracing::warn!(index, "zip entry escapes the destination; skipped");
            continue;
        };
        let target = destination.join(relative);
        if entry.is_dir() {
            fs::create_dir_all(&target)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = File::create(&target)?;
        copy(&mut entry, &mut file, &mut buffer, cancel, progress)?;
    }
    Ok(())
}

/// `io::copy` with a cancel check and progress per buffer.
fn copy(
    from: &mut dyn Read,
    to: &mut dyn Write,
    buffer: &mut [u8],
    cancel: &AtomicBool,
    progress: &mut Progress<'_>,
) -> Result<(), ArchiveError> {
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        let read = from.read(buffer)?;
        if read == 0 {
            return Ok(());
        }
        to.write_all(buffer.get(..read).unwrap_or_default())?;
        progress.advance(read as u64);
    }
}

/// `<parent>/<stem>.<extension>` or, when taken, `<stem> (2)`, `<stem> (3)`, … as Explorer
/// names copies. An empty `extension` names a folder.
fn unique_path(parent: &Path, stem: &str, extension: &str) -> PathBuf {
    let name = |suffix: u32| {
        let mut name = stem.to_owned();
        if suffix > 1 {
            name.push_str(" (");
            name.push_str(&suffix.to_string());
            name.push(')');
        }
        if !extension.is_empty() {
            name.push('.');
            name.push_str(extension);
        }
        parent.join(name)
    };
    // Bounded like Explorer is in practice; past that the last candidate is overwritten.
    (1..=u32::from(u16::MAX))
        .map(name)
        .find(|candidate| !candidate.exists())
        .unwrap_or_else(|| name(1))
}
