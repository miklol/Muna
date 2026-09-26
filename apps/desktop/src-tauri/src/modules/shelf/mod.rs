//! Shelf module (docs/modules/shelf.md): a parking place for files and text snippets. Items
//! arrive through the Drop actions *Shelf* tile (paths, via [`ShelfIntake`]) or as text from
//! the panel, persist in the profile database, and leave by drag-out, *Copy*, *Remove* or
//! expiry.
//!
//! The UI only ever sees ids, names, sizes and thumbnails — never a path or the text of a
//! snippet beyond its preview (docs/03-architecture.md "UI never touches the OS"; paths are
//! personal data). Drag-out and *Copy* resolve ids to paths here and hand a [`DragPayload`] to
//! the platform. Thumbnails come from Explorer (`IShellItemImageFactory`) through
//! [`muna_platform::FileOps::thumbnail`] and are cached per item for the life of the process.
//!
//! Tauri-free so it runs under `cargo test` against `FakePlatform`; the backend only schedules
//! the hourly expiry sweep.

pub mod settings;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::artwork::data_url;
use muna_core::{
    Clock, Int53, NewShelfItem, Settings, ShelfIntake, ShelfIntakeError, ShelfItemKind,
    ShelfRecord, Store, StoreError,
};
use muna_platform::{DragPayload, Platform, PlatformError, TransferMode};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
pub use settings::{MAX_EXPIRY_DAYS, ShelfSettings};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};

/// Module id and settings namespace.
pub const ID: &str = "shelf";
/// Thumbnail side in device pixels: the grid tile is 64 CSS px, rendered up to 2×.
pub const THUMBNAIL_SIZE: u32 = 128;
/// Most characters of a snippet the UI gets as a preview.
pub const PREVIEW_CHARS: usize = 240;
/// Most characters a snippet keeps; longer text is cut when added.
pub const MAX_TEXT_CHARS: usize = 100_000;
/// How often the backend sweeps expired items.
pub const SWEEP_INTERVAL: Duration = Duration::from_hours(1);

/// One item as the panel sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItem {
    pub id: String,
    pub kind: ShelfItemKind,
    /// The file name, or the first line of the snippet.
    pub name: String,
    /// Lower-case file extension without the dot, for the placeholder tile.
    pub extension: Option<String>,
    /// Bytes, when known.
    #[specta(type = Option<Int53>)]
    pub size: Option<i64>,
    /// `true` for a folder.
    pub is_folder: bool,
    /// The file is a copy in Shelf storage.
    pub copied: bool,
    /// The referenced file is gone (docs/modules/shelf.md "broken-link state").
    pub missing: bool,
    /// Snippets only: the text, cut to [`PREVIEW_CHARS`].
    pub preview: Option<String>,
    #[specta(type = Int53)]
    pub added_at_ms: i64,
}

/// Everything the panel shows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ShelfSnapshot {
    pub items: Vec<ShelfItem>,
    pub settings: ShelfSettings,
}

/// What the panel asks for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ShelfCommand {
    /// Park a text snippet (a paste into the panel).
    AddText {
        text: String,
    },
    Remove {
        ids: Vec<String>,
    },
    /// Remove every item whose file is gone.
    RemoveMissing,
    Clear,
    /// Open a file with its default handler.
    Open {
        id: String,
    },
    /// Explorer with the files selected.
    Reveal {
        ids: Vec<String>,
    },
    /// The items on the clipboard: files as `CF_HDROP`, a lone snippet as text.
    Copy {
        ids: Vec<String>,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum ShelfError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Platform(#[from] PlatformError),
    #[error("no item with this id")]
    UnknownItem,
    #[error("a snippet needs some text")]
    EmptyText,
    #[error("none of the items can be dragged or copied")]
    NothingToCarry,
    #[error("Shelf storage is not available")]
    NoStorage,
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait ShelfSink: Send + Sync {
    fn changed(&self, snapshot: &ShelfSnapshot);
}

pub struct ShelfService {
    platform: Arc<dyn Platform>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    /// `%LOCALAPPDATA%\Muna\shelf`; `None` disables copies (tests without a profile).
    storage_dir: Option<PathBuf>,
    settings: Mutex<ShelfSettings>,
    /// The module is in `shell.disabledModules`: the drop tile refuses items meanwhile.
    disabled: AtomicBool,
    sink: Mutex<Option<Arc<dyn ShelfSink>>>,
    /// Item id → PNG data URL, filled on first request.
    thumbnails: Mutex<HashMap<String, Arc<str>>>,
}

impl std::fmt::Debug for ShelfService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ShelfService")
            .field("settings", &*self.settings.lock())
            .field("disabled", &self.disabled.load(Ordering::Relaxed))
            .field("storage", &self.storage_dir.is_some())
            .field("thumbnails", &self.thumbnails.lock().len())
            .finish_non_exhaustive()
    }
}

impl ShelfService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        storage_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            platform,
            store,
            clock,
            storage_dir,
            settings: Mutex::new(ShelfSettings::default()),
            disabled: AtomicBool::new(false),
            sink: Mutex::new(None),
            thumbnails: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn ShelfSink>) {
        *self.sink.lock() = Some(sink);
    }

    /// Reads the namespace from a settings document and tells the sink. A shorter expiry
    /// takes effect at the next sweep. Also notes whether the module is turned off
    /// (`shell.disabledModules`), which the drop tile's intake honours.
    pub fn apply_settings(&self, settings: &Settings) {
        let disabled = settings
            .shell
            .disabled_modules
            .iter()
            .any(|module| module == ID);
        self.disabled.store(disabled, Ordering::Relaxed);
        let next = ShelfSettings::from_document(settings);
        {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            *current = next;
        }
        self.emit();
    }

    #[must_use]
    pub fn settings(&self) -> ShelfSettings {
        self.settings.lock().clone()
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    /// Everything the panel shows. Stats every file for the missing state, so callers use a
    /// blocking thread.
    pub fn snapshot(&self) -> Result<ShelfSnapshot, ShelfError> {
        let items = self.store.shelf_items()?.iter().map(wire_item).collect();
        Ok(ShelfSnapshot {
            items,
            settings: self.settings(),
        })
    }

    /// Parks `paths`; copies them into Shelf storage first when the setting is on. Returns
    /// how many were new. Blocks for the copy (the shell's own dialog covers a long one).
    pub fn add_files(&self, paths: &[PathBuf]) -> Result<usize, ShelfError> {
        let copy = self.settings().copy_into_storage;
        let mut items = Vec::with_capacity(paths.len());
        for path in paths {
            let stored = if copy {
                self.copy_into_storage(path)?
            } else {
                path.clone()
            };
            let size = std::fs::metadata(&stored)
                .ok()
                .filter(std::fs::Metadata::is_file)
                .and_then(|meta| i64::try_from(meta.len()).ok());
            items.push(NewShelfItem::file(stored, size, copy));
        }
        let added = self.store.insert_shelf_items(&items, self.now_ms())?;
        if !added.is_empty() {
            tracing::info!(added = added.len(), copied = copy, "shelf items added");
            self.emit();
        }
        Ok(added.len())
    }

    /// Applies a command and tells the sink; the reply is the snapshot after it.
    pub fn command(&self, command: ShelfCommand) -> Result<ShelfSnapshot, ShelfError> {
        match command {
            ShelfCommand::AddText { text } => {
                let text = text.trim();
                if text.is_empty() {
                    return Err(ShelfError::EmptyText);
                }
                let text: String = text.chars().take(MAX_TEXT_CHARS).collect();
                let added = self
                    .store
                    .insert_shelf_items(&[NewShelfItem::text(text)], self.now_ms())?;
                if !added.is_empty() {
                    tracing::info!("shelf snippet added");
                    self.emit();
                }
            }
            ShelfCommand::Remove { ids } => {
                let removed = self.store.remove_shelf_items(&ids)?;
                self.forget(&removed);
                if !removed.is_empty() {
                    tracing::info!(removed = removed.len(), "shelf items removed");
                    self.emit();
                }
            }
            ShelfCommand::RemoveMissing => {
                let missing: Vec<String> = self
                    .store
                    .shelf_items()?
                    .into_iter()
                    .filter(is_missing)
                    .map(|record| record.id)
                    .collect();
                let removed = self.store.remove_shelf_items(&missing)?;
                self.forget(&removed);
                if !removed.is_empty() {
                    tracing::info!(removed = removed.len(), "missing shelf items removed");
                    self.emit();
                }
            }
            ShelfCommand::Clear => {
                let removed = self.store.clear_shelf()?;
                self.forget(&removed);
                if !removed.is_empty() {
                    tracing::info!(removed = removed.len(), "shelf cleared");
                    self.emit();
                }
            }
            ShelfCommand::Open { id } => {
                let records = self.store.shelf_items_by_id(&[id])?;
                let record = records.first().ok_or(ShelfError::UnknownItem)?;
                let path = record.path.as_deref().ok_or(ShelfError::NothingToCarry)?;
                self.platform.file_ops().open(path)?;
            }
            ShelfCommand::Reveal { ids } => {
                let paths = self.paths_of(&ids)?;
                if paths.is_empty() {
                    return Err(ShelfError::NothingToCarry);
                }
                self.platform.file_ops().reveal(&paths)?;
            }
            ShelfCommand::Copy { ids } => {
                let payload = self.payload(&ids)?;
                self.platform.drag_source().place_on_clipboard(&payload)?;
                tracing::info!(items = payload_len(&payload), "shelf items copied");
            }
        }
        self.snapshot()
    }

    /// What a drag out of the panel carries for `ids`: every present file as `CF_HDROP`, or
    /// the text of a lone snippet. Missing files are skipped.
    pub fn payload(&self, ids: &[String]) -> Result<DragPayload, ShelfError> {
        let records = self.store.shelf_items_by_id(ids)?;
        if records.is_empty() {
            return Err(ShelfError::UnknownItem);
        }
        let paths: Vec<PathBuf> = records
            .iter()
            .filter(|record| !is_missing(record))
            .filter_map(|record| record.path.clone())
            .collect();
        if !paths.is_empty() {
            return Ok(DragPayload::Files(paths));
        }
        let snippets: Vec<&str> = records
            .iter()
            .filter_map(|record| record.text.as_deref())
            .collect();
        if snippets.is_empty() {
            return Err(ShelfError::NothingToCarry);
        }
        Ok(DragPayload::Text(snippets.join("\n\n")))
    }

    /// Explorer's thumbnail for one file item as a PNG data URL; `None` for snippets and for
    /// files the shell cannot picture (the UI shows the extension). Cached after the first
    /// call. Blocking.
    pub fn thumbnail(&self, id: &str) -> Result<Option<String>, ShelfError> {
        if let Some(cached) = self.thumbnails.lock().get(id) {
            return Ok(Some(cached.to_string()));
        }
        let records = self.store.shelf_items_by_id(&[id.to_owned()])?;
        let record = records.first().ok_or(ShelfError::UnknownItem)?;
        let Some(path) = record.path.as_deref() else {
            return Ok(None);
        };
        match self.platform.file_ops().thumbnail(path, THUMBNAIL_SIZE) {
            Ok(png) => {
                let url: Arc<str> = data_url(&png, "image/png").into();
                self.thumbnails
                    .lock()
                    .insert(id.to_owned(), Arc::clone(&url));
                Ok(Some(url.to_string()))
            }
            Err(PlatformError::NotFound(_)) => Ok(None),
            Err(error) => {
                tracing::debug!(%error, "shelf thumbnail unavailable");
                Ok(None)
            }
        }
    }

    /// Removes items older than the expiry setting; `true` when anything went.
    pub fn sweep(&self) -> Result<bool, ShelfError> {
        let Some(expiry_ms) = self.settings().expiry_ms() else {
            return Ok(false);
        };
        let removed = self.store.expire_shelf_items(self.now_ms() - expiry_ms)?;
        self.forget(&removed);
        if removed.is_empty() {
            return Ok(false);
        }
        tracing::info!(removed = removed.len(), "shelf items expired");
        self.emit();
        Ok(true)
    }

    fn paths_of(&self, ids: &[String]) -> Result<Vec<PathBuf>, ShelfError> {
        Ok(self
            .store
            .shelf_items_by_id(ids)?
            .into_iter()
            .filter_map(|record| record.path)
            .collect())
    }

    /// Copies `path` into its own folder under Shelf storage and returns the copy's path.
    fn copy_into_storage(&self, path: &Path) -> Result<PathBuf, ShelfError> {
        let storage = self.storage_dir.as_deref().ok_or(ShelfError::NoStorage)?;
        let name = path
            .file_name()
            .ok_or_else(|| PlatformError::NotFound(path.display().to_string()))?;
        let folder = storage.join(unique_folder_name(self.now_ms()));
        std::fs::create_dir_all(&folder).map_err(|error| {
            tracing::warn!(%error, "shelf storage folder could not be created");
            ShelfError::NoStorage
        })?;
        self.platform
            .file_ops()
            .transfer(&[path.to_path_buf()], &folder, TransferMode::Copy)?;
        Ok(folder.join(name))
    }

    /// Drops the copies and cached thumbnails of removed items.
    fn forget(&self, removed: &[ShelfRecord]) {
        let mut thumbnails = self.thumbnails.lock();
        for record in removed {
            thumbnails.remove(&record.id);
            if record.copied
                && let Some(path) = &record.path
            {
                self.delete_copy(path);
            }
        }
    }

    /// Deletes one copy's folder, and only inside Shelf storage.
    fn delete_copy(&self, path: &Path) {
        let Some(storage) = &self.storage_dir else {
            return;
        };
        let Some(folder) = path.parent() else {
            return;
        };
        if folder.parent() != Some(storage.as_path()) {
            tracing::warn!("shelf copy outside storage left alone");
            return;
        }
        if let Err(error) = std::fs::remove_dir_all(folder)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(%error, "shelf copy could not be deleted");
        }
    }

    fn emit(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            match self.snapshot() {
                Ok(snapshot) => sink.changed(&snapshot),
                Err(error) => tracing::warn!(%error, "shelf snapshot failed"),
            }
        }
    }
}

impl ShelfIntake for ShelfService {
    fn add_files(&self, paths: &[PathBuf]) -> Result<usize, ShelfIntakeError> {
        if self.disabled.load(Ordering::Relaxed) {
            return Err(ShelfIntakeError::Disabled);
        }
        Self::add_files(self, paths).map_err(|error| ShelfIntakeError::Store(error.to_string()))
    }
}

fn wire_item(record: &ShelfRecord) -> ShelfItem {
    let path = record.path.as_deref();
    let metadata = path.and_then(|path| std::fs::metadata(path).ok());
    ShelfItem {
        id: record.id.clone(),
        kind: record.kind,
        name: record.name.clone(),
        extension: path
            .and_then(Path::extension)
            .map(|ext| ext.to_string_lossy().to_lowercase())
            .filter(|ext| !ext.is_empty()),
        size: record.size.or_else(|| {
            metadata
                .as_ref()
                .filter(|m| m.is_file())
                .and_then(|m| i64::try_from(m.len()).ok())
        }),
        is_folder: metadata.as_ref().is_some_and(std::fs::Metadata::is_dir),
        copied: record.copied,
        missing: record.kind == ShelfItemKind::File && metadata.is_none(),
        preview: record.text.as_deref().map(preview),
        added_at_ms: record.added_at_ms,
    }
}

fn is_missing(record: &ShelfRecord) -> bool {
    record.kind == ShelfItemKind::File && record.path.as_deref().is_none_or(|path| !path.exists())
}

/// The first [`PREVIEW_CHARS`] characters of a snippet.
fn preview(text: &str) -> String {
    let mut out: String = text.chars().take(PREVIEW_CHARS).collect();
    if text.chars().count() > PREVIEW_CHARS {
        out.push('…');
    }
    out
}

fn payload_len(payload: &DragPayload) -> usize {
    match payload {
        DragPayload::Files(paths) => paths.len(),
        DragPayload::Text(_) => 1,
    }
}

/// A folder name that is unique per call: the time plus a counter.
fn unique_folder_name(now_ms: i64) -> String {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{now_ms:x}-{n:04x}")
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: items arrive through the Drop actions tile and IPC; the only thing to run is
/// the expiry sweep, once at start and hourly.
#[derive(Debug)]
pub struct ShelfModule(pub Arc<ShelfService>);

impl ModuleBackend for ShelfModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                let service = Arc::clone(&service);
                if let Err(error) = tauri::async_runtime::spawn_blocking(move || service.sweep())
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|result| result.map_err(|error| error.to_string()))
                {
                    tracing::warn!(error, "shelf sweep failed");
                }
                tokio::time::sleep(SWEEP_INTERVAL).await;
            }
        });
        Ok(())
    }
}
