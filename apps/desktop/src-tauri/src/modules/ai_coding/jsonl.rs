//! Incremental reads of append-only JSON-lines files (docs/modules/ai-coding.md): the agents'
//! session logs and transcripts grow while a session runs, so the module remembers how far it
//! read and takes only what was appended since. A file that is already large when first seen
//! is read from its end, and anything counted from it is a lower bound ([`Tail::is_partial`]).

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// A file up to this size is read whole when first seen, so counts are exact; a larger one
/// starts at its end. Eight mebibytes is a few thousand turns and reads in tens of
/// milliseconds.
pub const FULL_READ_LIMIT: u64 = 8 * 1024 * 1024;
/// The most one read takes; more than this appended between two reads means a burst (a
/// resumed session replaying), and the reader skips to the last cap and resyncs at a newline.
pub const READ_CAP: u64 = 4 * 1024 * 1024;

/// A cursor into one file. Nothing is held open between reads.
#[derive(Debug)]
pub struct Tail {
    path: PathBuf,
    offset: u64,
    /// Bytes of an unfinished last line, kept until its newline arrives.
    carry: Vec<u8>,
    /// `true` once any part of the file was skipped rather than read.
    partial: bool,
    /// `true` after a skip until the next newline is found: the bytes before it belong to a
    /// line whose start was skipped.
    resync: bool,
}

impl Tail {
    /// Points at the start of `path` when the file is at most [`FULL_READ_LIMIT`] bytes (or
    /// does not exist yet), at its end otherwise. Reads nothing beyond the last byte, which
    /// says whether the end is a line boundary.
    #[must_use]
    pub fn open(path: PathBuf) -> Self {
        let len = fs::metadata(&path).map_or(0, |meta| meta.len());
        if len <= FULL_READ_LIMIT {
            return Self {
                path,
                offset: 0,
                carry: Vec::new(),
                partial: false,
                resync: false,
            };
        }
        let ends_with_newline = File::open(&path)
            .and_then(|mut file| {
                file.seek(SeekFrom::Start(len - 1))?;
                let mut last = [0u8; 1];
                file.read_exact(&mut last)?;
                Ok(last[0] == b'\n')
            })
            .unwrap_or(false);
        Self {
            path,
            offset: len,
            carry: Vec::new(),
            partial: true,
            resync: !ends_with_newline,
        }
    }

    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// `true` when some of the file was never read, so counts derived from it are lower bounds.
    #[must_use]
    pub fn is_partial(&self) -> bool {
        self.partial
    }

    /// The complete lines appended since the last read, without their line endings. A file
    /// that shrank (rewritten) is read again from the start; a missing file yields nothing.
    pub fn read_new(&mut self) -> io::Result<Vec<String>> {
        let len = match fs::metadata(&self.path) {
            Ok(meta) => meta.len(),
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        if len < self.offset {
            self.offset = 0;
            self.carry.clear();
            self.resync = false;
        }
        if len == self.offset {
            return Ok(Vec::new());
        }
        let mut to_read = len - self.offset;
        if to_read > READ_CAP {
            self.offset = len - READ_CAP;
            to_read = READ_CAP;
            self.carry.clear();
            self.partial = true;
            self.resync = true;
        }
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(self.offset))?;
        let mut bytes = std::mem::take(&mut self.carry);
        let carried = bytes.len();
        let mut chunk = Vec::with_capacity(usize::try_from(to_read).unwrap_or(usize::MAX));
        file.take(to_read).read_to_end(&mut chunk)?;
        self.offset += chunk.len() as u64;
        bytes.extend_from_slice(&chunk);
        drop(chunk);

        let mut lines = Vec::new();
        let mut start = 0;
        while let Some(rel) = bytes[start..].iter().position(|&b| b == b'\n') {
            let end = start + rel;
            if self.resync {
                self.resync = false;
            } else {
                let line = &bytes[start..end];
                let line = line.strip_suffix(b"\r").unwrap_or(line);
                if !line.is_empty() {
                    lines.push(String::from_utf8_lossy(line).into_owned());
                }
            }
            start = end + 1;
        }
        debug_assert!(carried <= bytes.len());
        self.carry = bytes.split_off(start);
        Ok(lines)
    }
}
