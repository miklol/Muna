//! The `notes` module backend (docs/modules/notes.md): plain Markdown files in a folder the
//! user can point anywhere — the default `%APPDATA%\Muna\notes` or an Obsidian vault — listed
//! newest first with pinned notes on top, opened and saved by the panel's editor, and reached
//! from anywhere through the `notes.quickNote` action, which opens *Inbox* with the caret at
//! the end.
//!
//! The files are the truth: nothing about a note is kept anywhere else except which ones are
//! pinned (the store's meta table, so other apps see clean files). There is no watcher in this
//! build — every snapshot request rescans the folder (a directory walk plus a 4 KB read for
//! files whose size or time changed), and a save checks the file's modified time against what
//! the editor loaded so an edit made elsewhere is never overwritten. Nothing here ticks.

pub mod files;
pub mod settings;

use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use muna_core::{Int53, Settings, Store, StoreError};
use muna_platform::{Platform, PlatformError};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use files::{INBOX_ID, INBOX_STEM, MAX_NOTE_BYTES};
pub use settings::NotesSettings;

pub const ID: &str = "notes";
/// Store meta key holding the pinned ids as a JSON array.
pub const PINS_KEY: &str = "notes:pins";
/// The most ids one search answers with.
pub const SEARCH_LIMIT: usize = 100;

/// One note as the list shows it. `id` is the path relative to the folder with `/`
/// separators; `title` its file stem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    /// The sub-folder, relative to the notes folder; empty at the root.
    pub folder: String,
    /// The first words of the body, marks stripped; empty for an empty note.
    pub excerpt: String,
    /// Unix milliseconds of the file's modified time.
    #[specta(type = Int53)]
    pub modified_ms: i64,
    #[specta(type = Int53)]
    pub bytes: i64,
    pub pinned: bool,
}

/// A note as the editor holds it. `modified_ms` is the baseline a save sends back, so an edit
/// made by another app in between is noticed instead of overwritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub id: String,
    pub title: String,
    pub body: String,
    #[specta(type = Int53)]
    pub modified_ms: i64,
}

/// What the editor sends back to save: the body, and the modified time of the [`NoteContent`]
/// it loaded so a file changed elsewhere since is never overwritten.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NoteDraft {
    pub id: String,
    pub body: String,
    #[specta(type = Int53)]
    pub base_modified_ms: i64,
}

/// Why the folder could not be listed. `Missing` is only ever a folder the user chose: the
/// default one is created on demand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FolderProblem {
    Missing,
    Unreadable,
}

/// What the panel, the widget and the settings pane render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NotesSnapshot {
    /// The folder in use, for display; empty when this build has none (a test profile).
    pub folder: String,
    /// Whether `folder` is the default rather than one the user chose.
    pub default_folder: bool,
    /// Pinned notes first, then the rest, newest first within each group.
    pub notes: Vec<Note>,
    /// `Inbox.md` when it exists.
    pub inbox_id: Option<String>,
    pub problem: Option<FolderProblem>,
}

/// Commands that answer with the snapshot after them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum NotesCommand {
    /// Rescan the folder (the panel opening, *Refresh* in the pane).
    Refresh,
    Pin {
        id: String,
        pinned: bool,
    },
    /// To the Recycle Bin, never a permanent delete.
    Delete {
        id: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum NotesError {
    #[error("this build has no notes folder")]
    NoFolder,
    #[error("the note is not in the folder")]
    Unknown,
    #[error("the note changed on disk since it was opened")]
    Conflict,
    #[error("the note is too large for the editor")]
    TooLarge,
    #[error("a note needs a title")]
    EmptyTitle,
    #[error(transparent)]
    Io(io::Error),
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Platform(#[from] PlatformError),
}

impl From<io::Error> for NotesError {
    fn from(error: io::Error) -> Self {
        match error.kind() {
            io::ErrorKind::NotFound => Self::Unknown,
            io::ErrorKind::FileTooLarge => Self::TooLarge,
            _ => Self::Io(error),
        }
    }
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait NotesSink: Send + Sync {
    fn changed(&self, snapshot: &NotesSnapshot);
}

/// The excerpt of a file as last read, keyed by id, with the size and time it was read at.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Head {
    modified_ms: i64,
    bytes: u64,
    excerpt: String,
}

#[derive(Debug, Default)]
struct Inner {
    heads: HashMap<String, Head>,
    pins: Vec<String>,
    pins_loaded: bool,
}

pub struct NotesService {
    platform: Arc<dyn Platform>,
    store: Arc<Store>,
    /// `%APPDATA%\Muna\notes`; `None` in a build without a profile (tests), where only a
    /// folder from the settings works.
    default_folder: Option<PathBuf>,
    settings: Mutex<NotesSettings>,
    sink: Mutex<Option<Arc<dyn NotesSink>>>,
    inner: Mutex<Inner>,
}

impl std::fmt::Debug for NotesService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotesService")
            .field("default_folder", &self.default_folder)
            .field("settings", &*self.settings.lock())
            .finish_non_exhaustive()
    }
}

impl NotesService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        store: Arc<Store>,
        default_folder: Option<PathBuf>,
    ) -> Self {
        Self {
            platform,
            store,
            default_folder,
            settings: Mutex::new(NotesSettings::default()),
            sink: Mutex::new(None),
            inner: Mutex::new(Inner::default()),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn NotesSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> NotesSettings {
        self.settings.lock().clone()
    }

    /// The folder in use: the one from the settings, else the default.
    #[must_use]
    pub fn folder(&self) -> Option<PathBuf> {
        self.settings
            .lock()
            .folder
            .as_deref()
            .map(PathBuf::from)
            .or_else(|| self.default_folder.clone())
    }

    fn is_default(&self) -> bool {
        self.settings.lock().folder.is_none()
    }

    /// Applies `settings.modules.notes` (start-up and every settings change). A new folder
    /// drops the excerpt cache and tells the sink what is there.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = NotesSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.inner.lock().heads.clear();
        let snapshot = self.refresh();
        self.notify(&snapshot);
    }

    /// Rescans the folder and returns what is there. Cheap enough to run for every panel
    /// open: a directory walk, and the head of each file whose size or time changed.
    #[must_use]
    pub fn refresh(&self) -> NotesSnapshot {
        let Some(folder) = self.folder() else {
            return NotesSnapshot {
                folder: String::new(),
                default_folder: true,
                notes: Vec::new(),
                inbox_id: None,
                problem: Some(FolderProblem::Missing),
            };
        };
        let default_folder = self.is_default();
        let display = folder.to_string_lossy().into_owned();
        if default_folder
            && !folder.is_dir()
            && let Err(error) = std::fs::create_dir_all(&folder)
        {
            tracing::warn!(%error, "notes default folder could not be created");
        }
        let problem = if folder.is_dir() {
            None
        } else {
            Some(FolderProblem::Missing)
        };
        let scanned = match problem {
            Some(_) => Vec::new(),
            None => match files::scan(&folder) {
                Ok(scanned) => scanned,
                Err(error) => {
                    tracing::warn!(%error, "notes folder could not be listed");
                    return NotesSnapshot {
                        folder: display,
                        default_folder,
                        notes: Vec::new(),
                        inbox_id: None,
                        problem: Some(FolderProblem::Unreadable),
                    };
                }
            },
        };

        let mut inner = self.inner.lock();
        self.load_pins(&mut inner);
        let mut heads = HashMap::with_capacity(scanned.len());
        let mut notes = Vec::with_capacity(scanned.len());
        for file in scanned {
            let excerpt = match inner.heads.get(&file.id) {
                Some(head) if head.modified_ms == file.modified_ms && head.bytes == file.bytes => {
                    head.excerpt.clone()
                }
                _ => files::excerpt(&file.path).unwrap_or_else(|error| {
                    tracing::debug!(%error, id = %file.id, "note head unreadable");
                    String::new()
                }),
            };
            heads.insert(
                file.id.clone(),
                Head {
                    modified_ms: file.modified_ms,
                    bytes: file.bytes,
                    excerpt: excerpt.clone(),
                },
            );
            notes.push(Note {
                title: files::title_of(&file.id),
                folder: files::parent_of(&file.id),
                excerpt,
                modified_ms: file.modified_ms,
                bytes: i64::try_from(file.bytes).unwrap_or(i64::MAX),
                pinned: inner.pins.contains(&file.id),
                id: file.id,
            });
        }
        inner.heads = heads;
        // A pin for a file that is gone (deleted or moved elsewhere) is dropped, but only when
        // the folder was listed: an unmounted vault keeps its pins for when it is back.
        if problem.is_none() {
            let before = inner.pins.len();
            inner
                .pins
                .retain(|id| notes.iter().any(|note| &note.id == id));
            if inner.pins.len() != before {
                self.save_pins(&inner);
            }
        }
        drop(inner);

        notes.sort_by(|a, b| {
            b.pinned
                .cmp(&a.pinned)
                .then_with(|| b.modified_ms.cmp(&a.modified_ms))
                .then_with(|| a.id.cmp(&b.id))
        });
        let inbox_id = notes
            .iter()
            .find(|note| note.id == INBOX_ID)
            .map(|note| note.id.clone());
        NotesSnapshot {
            folder: display,
            default_folder,
            notes,
            inbox_id,
            problem,
        }
    }

    /// Applies a command and answers with the snapshot after it.
    pub fn command(&self, command: NotesCommand) -> Result<NotesSnapshot, NotesError> {
        match command {
            NotesCommand::Refresh => {}
            NotesCommand::Pin { id, pinned } => {
                let folder = self.folder().ok_or(NotesError::NoFolder)?;
                let path = files::path_of(&folder, &id).ok_or(NotesError::Unknown)?;
                if !path.is_file() {
                    return Err(NotesError::Unknown);
                }
                let mut inner = self.inner.lock();
                self.load_pins(&mut inner);
                let was = inner.pins.contains(&id);
                if pinned && !was {
                    inner.pins.push(id);
                    self.save_pins(&inner);
                } else if !pinned && was {
                    inner.pins.retain(|pin| pin != &id);
                    self.save_pins(&inner);
                }
            }
            NotesCommand::Delete { id } => {
                let folder = self.folder().ok_or(NotesError::NoFolder)?;
                let path = files::path_of(&folder, &id).ok_or(NotesError::Unknown)?;
                if !path.is_file() {
                    return Err(NotesError::Unknown);
                }
                self.platform
                    .file_ops()
                    .recycle(std::slice::from_ref(&path))?;
                let mut inner = self.inner.lock();
                inner.heads.remove(&id);
                if inner.pins.contains(&id) {
                    inner.pins.retain(|pin| pin != &id);
                    self.save_pins(&inner);
                }
            }
        }
        let snapshot = self.refresh();
        self.notify(&snapshot);
        Ok(snapshot)
    }

    /// A new empty note named after `title` (`Title.md`, or `Title 2.md` when taken) at the
    /// folder's root; the editor opens it.
    pub fn create(&self, title: &str) -> Result<NoteContent, NotesError> {
        let folder = self.ready_folder()?;
        if title.trim().is_empty() {
            return Err(NotesError::EmptyTitle);
        }
        let path = files::unique_path(&folder, &files::stem_for(title));
        let modified_ms = files::write(&path, "")?;
        let id = files::id_of(&folder, &path).ok_or(NotesError::Unknown)?;
        self.announce();
        Ok(NoteContent {
            title: files::title_of(&id),
            id,
            body: String::new(),
            modified_ms,
        })
    }

    /// The note for the editor.
    pub fn open(&self, id: &str) -> Result<NoteContent, NotesError> {
        let folder = self.folder().ok_or(NotesError::NoFolder)?;
        let path = files::path_of(&folder, id).ok_or(NotesError::Unknown)?;
        let (body, modified_ms) = files::read(&path)?;
        Ok(NoteContent {
            id: id.to_owned(),
            title: files::title_of(id),
            body,
            modified_ms,
        })
    }

    /// *Inbox* for quick capture, created empty when it does not exist yet.
    pub fn open_inbox(&self) -> Result<NoteContent, NotesError> {
        let folder = self.ready_folder()?;
        let path = folder.join(format!("{INBOX_STEM}.{}", files::EXTENSION));
        if !path.is_file() {
            files::write(&path, "")?;
            self.announce();
        }
        self.open(INBOX_ID)
    }

    /// Writes the draft's body when the file is still the one the editor loaded
    /// (`base_modified_ms`); `Conflict` otherwise, and the editor reloads. Answers with the new
    /// baseline.
    pub fn save(&self, draft: &NoteDraft) -> Result<NoteContent, NotesError> {
        let folder = self.folder().ok_or(NotesError::NoFolder)?;
        let path = files::path_of(&folder, &draft.id).ok_or(NotesError::Unknown)?;
        let meta = std::fs::metadata(&path)?;
        if files::modified_ms(&meta) != draft.base_modified_ms {
            return Err(NotesError::Conflict);
        }
        let modified_ms = files::write(&path, &draft.body)?;
        self.announce();
        Ok(NoteContent {
            id: draft.id.clone(),
            title: files::title_of(&draft.id),
            body: draft.body.clone(),
            modified_ms,
        })
    }

    /// Renames the file to `title` (made safe, made unique) in its own sub-folder; a pin
    /// follows. Answers with the note under its new id.
    pub fn rename(&self, id: &str, title: &str) -> Result<Note, NotesError> {
        let folder = self.folder().ok_or(NotesError::NoFolder)?;
        let path = files::path_of(&folder, id).ok_or(NotesError::Unknown)?;
        if !path.is_file() {
            return Err(NotesError::Unknown);
        }
        if title.trim().is_empty() {
            return Err(NotesError::EmptyTitle);
        }
        let stem = files::stem_for(title);
        let dir = path.parent().unwrap_or(&folder).to_path_buf();
        let target = if stem == files::title_of(id) {
            path.clone()
        } else {
            files::unique_path(&dir, &stem)
        };
        if target != path {
            std::fs::rename(&path, &target)?;
        }
        let new_id = files::id_of(&folder, &target).ok_or(NotesError::Unknown)?;
        {
            let mut inner = self.inner.lock();
            self.load_pins(&mut inner);
            if let Some(head) = inner.heads.remove(id) {
                inner.heads.insert(new_id.clone(), head);
            }
            if let Some(pin) = inner.pins.iter_mut().find(|pin| pin.as_str() == id) {
                pin.clone_from(&new_id);
                self.save_pins(&inner);
            }
        }
        let snapshot = self.refresh();
        self.notify(&snapshot);
        snapshot
            .notes
            .into_iter()
            .find(|note| note.id == new_id)
            .ok_or(NotesError::Unknown)
    }

    /// Ids of the notes whose title or body contains `query` (case-insensitive), newest
    /// first, at most [`SEARCH_LIMIT`]. Reads every listed file; a blank query matches none.
    #[must_use]
    pub fn search(&self, query: &str) -> Vec<String> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Vec::new();
        }
        let Some(folder) = self.folder() else {
            return Vec::new();
        };
        let Ok(scanned) = files::scan(&folder) else {
            return Vec::new();
        };
        let mut hits = Vec::new();
        for file in scanned {
            let title_hit = files::title_of(&file.id).to_lowercase().contains(&needle);
            let body_hit = !title_hit
                && files::read(&file.path)
                    .is_ok_and(|(body, _)| body.to_lowercase().contains(&needle));
            if title_hit || body_hit {
                hits.push(file.id);
                if hits.len() >= SEARCH_LIMIT {
                    break;
                }
            }
        }
        hits
    }

    /// Shows the note in Explorer.
    pub fn reveal(&self, id: &str) -> Result<(), NotesError> {
        let path = self.existing_path(id)?;
        self.platform
            .file_ops()
            .reveal(std::slice::from_ref(&path))?;
        Ok(())
    }

    /// Opens the note in its default app (a note too large for the editor goes here).
    pub fn open_external(&self, id: &str) -> Result<(), NotesError> {
        let path = self.existing_path(id)?;
        self.platform.file_ops().open(&path)?;
        Ok(())
    }

    /// Opens Explorer on the folder itself.
    pub fn reveal_folder(&self) -> Result<(), NotesError> {
        let folder = self.ready_folder()?;
        self.platform.file_ops().open(&folder)?;
        Ok(())
    }

    /// The folder picker for Settings › Notes; `None` when the user dismissed it. Blocks
    /// while the dialog is up.
    pub fn choose_folder(&self, title: &str) -> Result<Option<PathBuf>, PlatformError> {
        self.platform.file_ops().pick_folder(0, title)
    }

    fn existing_path(&self, id: &str) -> Result<PathBuf, NotesError> {
        let folder = self.folder().ok_or(NotesError::NoFolder)?;
        let path = files::path_of(&folder, id).ok_or(NotesError::Unknown)?;
        if !path.is_file() {
            return Err(NotesError::Unknown);
        }
        Ok(path)
    }

    /// The folder, created when it is the default one; a chosen folder that is gone is an
    /// error rather than something to recreate on a drive that may be unmounted.
    fn ready_folder(&self) -> Result<PathBuf, NotesError> {
        let folder = self.folder().ok_or(NotesError::NoFolder)?;
        if !folder.is_dir() {
            if self.is_default() {
                std::fs::create_dir_all(&folder)?;
            } else {
                return Err(NotesError::Io(io::Error::new(
                    io::ErrorKind::NotFound,
                    "the notes folder is missing",
                )));
            }
        }
        Ok(folder)
    }

    fn load_pins(&self, inner: &mut Inner) {
        if inner.pins_loaded {
            return;
        }
        inner.pins_loaded = true;
        match self.store.get_meta(PINS_KEY) {
            Ok(Some(json)) => {
                inner.pins = serde_json::from_str(&json).unwrap_or_else(|error| {
                    tracing::warn!(%error, "notes pins malformed; starting empty");
                    Vec::new()
                });
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "notes pins unreadable"),
        }
    }

    fn save_pins(&self, inner: &Inner) {
        match serde_json::to_string(&inner.pins) {
            Ok(json) => {
                if let Err(error) = self.store.set_meta(PINS_KEY, &json) {
                    tracing::warn!(%error, "notes pins not saved");
                }
            }
            Err(error) => tracing::warn!(%error, "notes pins not encoded"),
        }
    }

    /// Rescans and tells the sink (after a write the list's order or excerpts changed).
    fn announce(&self) {
        let snapshot = self.refresh();
        self.notify(&snapshot);
    }

    fn notify(&self, snapshot: &NotesSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }
}

/// Where the default folder lives: `%APPDATA%\Muna\notes` (roaming, as docs/modules/notes.md
/// says — notes are the user's documents, not a cache), or `<profile>\notes` when the
/// variable is missing.
#[must_use]
pub fn default_folder(profile_dir: &Path) -> PathBuf {
    std::env::var_os("APPDATA").map_or_else(
        || profile_dir.join("notes"),
        |appdata| PathBuf::from(appdata).join("Muna").join("notes"),
    )
}

/// The backend: nothing runs at idle; the panel, the widget and the pane pull snapshots.
#[derive(Debug, Clone)]
pub struct NotesModule(pub Arc<NotesService>);

impl ModuleBackend for NotesModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel, Surface::Widget]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        tracing::debug!(folder = ?self.0.folder(), "notes folder");
        Ok(())
    }
}
