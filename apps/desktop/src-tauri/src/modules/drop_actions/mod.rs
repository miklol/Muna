//! Drop actions module (docs/modules/drop-actions.md): the tiles the notch morphs into while
//! files are dragged over it, and what happens when they land on one.
//!
//! The shell keeps every drag's paths in a [`DropSessions`] registry (the UI only sees names)
//! and the UI, which knows which tile the pointer released on, asks this service to `run` an
//! action on the session. Actions block until the shell's own dialogs are done, so the IPC
//! layer calls `run` on a blocking thread; progress and results reach the strip through the
//! live-activities hub and the UI through a [`DropSink`] snapshot.
//!
//! Tauri-free so it runs under `cargo test` against `FakePlatform`: the one action bound to a
//! window's thread (the share sheet) goes through a [`WindowThread`] the binary implements
//! with `run_on_main_thread`.

pub mod archive;
pub mod settings;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use muna_core::activities::priority;
use muna_core::{
    Activity, DropActionKind, DropSessionId, DropSessions, Hub, Leading, Notice, Settings,
    StripMessage, Trailing,
};
use muna_platform::{Platform, PlatformError, TransferMode, WindowHandle};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
pub use settings::{
    DropActionsSettings, DropFolder, DropTile, MAX_FOLDERS, TILES_PER_ROW, TILES_PER_ROW_EXPANDED,
};
use specta::Type;

use super::{ModuleBackend, ModuleCtx, Surface};

/// Module id and settings namespace.
pub const ID: &str = "drop-actions";
/// Finished jobs the snapshot keeps for the UI (the result pulse, a retry).
pub const KEPT_JOBS: usize = 8;
/// Picker titles when the UI sends none (it normally sends the localised tile title).
const COPY_TO_TITLE: &str = "Copy to";
const MOVE_TO_TITLE: &str = "Move to";

/// What the tile the items landed on asks for (docs/modules/drop-actions.md "Tiles").
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DropAction {
    /// The Windows share sheet (Nearby sharing, apps) with every item.
    Share,
    /// Copy or move into a configured folder.
    Folder { id: String },
    /// Pick a folder, then copy there. `title` is the picker's caption.
    CopyTo { title: String },
    /// Pick a folder, then move there.
    MoveTo { title: String },
    /// The system *Open with* dialog for the first item.
    OpenWith,
    /// One archive beside the first item.
    Zip,
    /// Every dropped archive into a folder beside it.
    Unzip,
    /// Explorer with the items selected.
    Reveal,
    /// The Recycle Bin — no confirmation: Explorer's Undo brings the items back.
    Trash,
    /// Safely remove the drive the first item is on.
    Eject,
}

/// Why a job did not finish; the UI phrases each (docs/07 UX copy: say what to do).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum DropFailure {
    /// The user closed a system dialog; no notice is shown.
    Cancelled,
    /// An item, the folder or the removable drive is gone.
    NotFound,
    /// The platform cannot do this (no share sheet, no removable volume).
    Unsupported,
    /// *Unzip* found no zip archive among the items.
    NoArchive,
    /// Anything else; the reason is in the log.
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DropJobState {
    /// `percent` is known for zip and unzip only; the shell's own dialogs cover the rest.
    Running {
        percent: Option<u8>,
    },
    Done,
    Failed {
        reason: DropFailure,
    },
}

/// One action on one drop, as the UI sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropJob {
    pub id: u32,
    pub action: DropActionKind,
    /// How many items the action works on.
    pub count: u32,
    pub state: DropJobState,
}

/// Everything the UI needs: the row and the recent jobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DropActionsSnapshot {
    pub settings: DropActionsSettings,
    pub jobs: Vec<DropJob>,
}

/// Why `run` refused before starting a job.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DropError {
    #[error("no dropped items for this session")]
    UnknownSession,
    #[error("the items have not been dropped yet")]
    NotDropped,
    #[error("no configured folder with this id")]
    UnknownFolder,
}

/// Receives every change to the snapshot.
pub trait DropSink: Send + Sync {
    fn changed(&self, snapshot: &DropActionsSnapshot);
}

/// Runs a job on the thread that owns a notch window, with its handle (`0` when the window is
/// gone). The share sheet needs it; nothing else does.
pub trait WindowThread: Send + Sync {
    fn run(&self, label: &str, job: Box<dyn FnOnce(WindowHandle) + Send + 'static>);
}

struct TrackedJob {
    job: DropJob,
    cancel: Arc<AtomicBool>,
}

struct Inner {
    settings: DropActionsSettings,
    jobs: Vec<TrackedJob>,
    next_job: u32,
}

/// The module object the IPC layer and the backend share.
pub struct DropActionsService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    sessions: Arc<DropSessions>,
    sink: Mutex<Option<Arc<dyn DropSink>>>,
    window_thread: Mutex<Option<Arc<dyn WindowThread>>>,
    inner: Mutex<Inner>,
}

impl std::fmt::Debug for DropActionsService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("DropActionsService")
            .field("tiles", &inner.settings.tiles.len())
            .field("jobs", &inner.jobs.len())
            .field("sessions", &self.sessions.len())
            .finish_non_exhaustive()
    }
}

impl DropActionsService {
    #[must_use]
    pub fn new(platform: Arc<dyn Platform>, hub: Arc<Hub>) -> Self {
        Self {
            platform,
            hub,
            sessions: Arc::new(DropSessions::new()),
            sink: Mutex::new(None),
            window_thread: Mutex::new(None),
            inner: Mutex::new(Inner {
                settings: DropActionsSettings::default(),
                jobs: Vec::new(),
                next_job: 0,
            }),
        }
    }

    /// The registry the shell writes drags into.
    #[must_use]
    pub fn sessions(&self) -> Arc<DropSessions> {
        Arc::clone(&self.sessions)
    }

    pub fn set_sink(&self, sink: Arc<dyn DropSink>) {
        *self.sink.lock() = Some(sink);
    }

    pub fn set_window_thread(&self, window_thread: Arc<dyn WindowThread>) {
        *self.window_thread.lock() = Some(window_thread);
    }

    /// Reads the namespace from a settings document and tells the sink.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = DropActionsSettings::from_document(settings);
        {
            let mut inner = self.inner.lock();
            if inner.settings == next {
                return;
            }
            inner.settings = next;
        }
        self.emit();
    }

    #[must_use]
    pub fn settings(&self) -> DropActionsSettings {
        self.inner.lock().settings.clone()
    }

    #[must_use]
    pub fn snapshot(&self) -> DropActionsSnapshot {
        let inner = self.inner.lock();
        DropActionsSnapshot {
            settings: inner.settings.clone(),
            jobs: inner.jobs.iter().map(|t| t.job.clone()).collect(),
        }
    }

    /// The drop landed outside every tile, or the user dismissed the confirmation: forget the
    /// items. `false` when the session was already gone.
    pub fn cancel_session(&self, session: DropSessionId) -> bool {
        self.sessions.remove(session)
    }

    /// Asks a running zip or unzip to stop at its next buffer; `false` for an unknown or
    /// finished job. Shell operations have their own cancel button.
    pub fn cancel_job(&self, job: u32) -> bool {
        let inner = self.inner.lock();
        match inner.jobs.iter().find(|t| t.job.id == job) {
            Some(tracked) if matches!(tracked.job.state, DropJobState::Running { .. }) => {
                tracked.cancel.store(true, Ordering::Relaxed);
                true
            }
            _ => false,
        }
    }

    /// Runs `action` on the dropped items of `session` and returns the finished job. Blocks
    /// for as long as the shell's dialogs are up: call it from a blocking thread.
    pub fn run(&self, session: DropSessionId, action: &DropAction) -> Result<DropJob, DropError> {
        let pending = self
            .sessions
            .get(session)
            .ok_or(DropError::UnknownSession)?;
        if !pending.dropped {
            return Err(DropError::NotDropped);
        }
        let folder = match action {
            DropAction::Folder { id } => Some(
                self.settings()
                    .folder(id)
                    .cloned()
                    .ok_or(DropError::UnknownFolder)?,
            ),
            _ => None,
        };
        let Some(dropped) = self.sessions.take(session) else {
            return Err(DropError::UnknownSession);
        };
        let kind = kind_of(action, folder.as_ref());
        let worked_on = match action {
            DropAction::Unzip => dropped
                .paths
                .iter()
                .filter(|path| archive::is_archive(path))
                .count(),
            _ => dropped.paths.len(),
        };
        let count = u32::try_from(worked_on).unwrap_or(u32::MAX);
        let (job, cancel) = self.start_job(kind, count);
        tracing::info!(job = job.id, ?kind, count, "drop action started");

        let mut progress = |percent: u8| self.update_progress(job.id, kind, count, percent);
        let outcome = self.execute(
            &job,
            action,
            folder.as_ref(),
            &dropped.label,
            &dropped.paths,
            &cancel,
            &mut progress,
        );
        let state = match outcome {
            Ok(()) => {
                tracing::info!(job = job.id, ?kind, "drop action finished");
                self.hub
                    .publish_notice(finished_notice(job.id, kind, count));
                DropJobState::Done
            }
            Err(reason) => {
                if reason == DropFailure::Cancelled {
                    tracing::info!(job = job.id, ?kind, "drop action cancelled");
                } else {
                    tracing::warn!(job = job.id, ?kind, ?reason, "drop action failed");
                    self.hub.publish_notice(failed_notice(job.id, kind));
                }
                DropJobState::Failed { reason }
            }
        };
        self.hub.retract_activity(&activity_id(job.id));
        Ok(self.finish_job(job.id, state))
    }

    fn start_job(&self, kind: DropActionKind, count: u32) -> (DropJob, Arc<AtomicBool>) {
        let cancel = Arc::new(AtomicBool::new(false));
        let job = {
            let mut inner = self.inner.lock();
            inner.next_job += 1;
            let job = DropJob {
                id: inner.next_job,
                action: kind,
                count,
                state: DropJobState::Running {
                    percent: has_progress(kind).then_some(0),
                },
            };
            inner.jobs.push(TrackedJob {
                job: job.clone(),
                cancel: Arc::clone(&cancel),
            });
            trim_finished(&mut inner.jobs);
            job
        };
        self.emit();
        (job, cancel)
    }

    /// Puts the job in the strip once its work is under way: after the folder picker for the
    /// pick-then-copy tiles, never for the actions that finish in milliseconds or put up a
    /// dialog of their own.
    fn announce(&self, job: &DropJob) {
        if is_long_running(job.action) {
            self.hub.publish_activity(running_activity(
                job.id,
                job.action,
                job.count,
                has_progress(job.action).then_some(0),
            ));
        }
    }

    fn update_progress(&self, id: u32, kind: DropActionKind, count: u32, percent: u8) {
        {
            let mut inner = self.inner.lock();
            let Some(tracked) = inner.jobs.iter_mut().find(|t| t.job.id == id) else {
                return;
            };
            tracked.job.state = DropJobState::Running {
                percent: Some(percent),
            };
        }
        self.hub
            .publish_activity(running_activity(id, kind, count, Some(percent)));
        self.emit();
    }

    fn finish_job(&self, id: u32, state: DropJobState) -> DropJob {
        let job = {
            let mut inner = self.inner.lock();
            let Some(tracked) = inner.jobs.iter_mut().find(|t| t.job.id == id) else {
                unreachable!("a running job is tracked until it finishes");
            };
            tracked.job.state = state;
            let job = tracked.job.clone();
            trim_finished(&mut inner.jobs);
            job
        };
        self.emit();
        job
    }

    #[allow(clippy::too_many_arguments)] // one call site; a struct would only rename the arguments
    fn execute(
        &self,
        job: &DropJob,
        action: &DropAction,
        folder: Option<&DropFolder>,
        label: &str,
        paths: &[PathBuf],
        cancel: &AtomicBool,
        progress: &mut dyn FnMut(u8),
    ) -> Result<(), DropFailure> {
        let file_ops = self.platform.file_ops();
        let first = paths.first().ok_or(DropFailure::NotFound)?;
        match action {
            DropAction::Share => self.share(label, paths),
            DropAction::Folder { .. } => {
                let folder = folder.ok_or(DropFailure::NotFound)?;
                self.announce(job);
                file_ops
                    .transfer(paths, Path::new(&folder.path), folder.mode)
                    .map_err(|error| failure_of(&error))
            }
            DropAction::CopyTo { title } => {
                let destination = self.pick_folder(title, COPY_TO_TITLE)?;
                self.announce(job);
                file_ops
                    .transfer(paths, &destination, TransferMode::Copy)
                    .map_err(|error| failure_of(&error))
            }
            DropAction::MoveTo { title } => {
                let destination = self.pick_folder(title, MOVE_TO_TITLE)?;
                self.announce(job);
                file_ops
                    .transfer(paths, &destination, TransferMode::Move)
                    .map_err(|error| failure_of(&error))
            }
            DropAction::OpenWith => file_ops
                .open_with(first)
                .map_err(|error| failure_of(&error)),
            DropAction::Zip => {
                self.announce(job);
                archive::zip(paths, cancel, progress)
                    .map(drop)
                    .map_err(|error| archive_failure(&error))
            }
            DropAction::Unzip => {
                let archives: Vec<&Path> = paths
                    .iter()
                    .filter(|path| archive::is_archive(path))
                    .map(PathBuf::as_path)
                    .collect();
                if archives.is_empty() {
                    return Err(DropFailure::NoArchive);
                }
                self.announce(job);
                unzip_all(&archives, cancel, progress)
            }
            DropAction::Reveal => file_ops.reveal(paths).map_err(|error| failure_of(&error)),
            DropAction::Trash => file_ops.recycle(paths).map_err(|error| failure_of(&error)),
            DropAction::Eject => file_ops.eject(first).map_err(|error| failure_of(&error)),
        }
    }

    /// The share sheet on the window's thread; inline with no window when none is wired
    /// (tests, a window that went away).
    fn share(&self, label: &str, paths: &[PathBuf]) -> Result<(), DropFailure> {
        let window_thread = self.window_thread.lock().clone();
        let Some(window_thread) = window_thread else {
            return self
                .platform
                .file_ops()
                .share(0, paths)
                .map_err(|error| failure_of(&error));
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let platform = Arc::clone(&self.platform);
        let items = paths.to_vec();
        window_thread.run(
            label,
            Box::new(move |window| {
                let _ = tx.send(platform.file_ops().share(window, &items));
            }),
        );
        rx.recv()
            .unwrap_or(Err(PlatformError::Os {
                api: "WindowThread::run",
                code: 0,
            }))
            .map_err(|error| failure_of(&error))
    }

    /// Opens the folder picker for Settings ("Add folder"), unowned like the Copy to / Move to
    /// pickers; `None` when the user dismissed it. Blocks while the dialog is up.
    pub fn choose_folder(&self, title: &str) -> Result<Option<PathBuf>, PlatformError> {
        self.platform.file_ops().pick_folder(0, title)
    }

    fn pick_folder(&self, title: &str, fallback: &str) -> Result<PathBuf, DropFailure> {
        let title = if title.trim().is_empty() {
            fallback
        } else {
            title
        };
        match self.platform.file_ops().pick_folder(0, title) {
            Ok(Some(folder)) => Ok(folder),
            Ok(None) => Err(DropFailure::Cancelled),
            Err(error) => Err(failure_of(&error)),
        }
    }

    fn emit(&self) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(&self.snapshot());
        }
    }
}

/// Unzips every archive (already filtered) in turn; progress is spread evenly across them.
fn unzip_all(
    archives: &[&Path],
    cancel: &AtomicBool,
    progress: &mut dyn FnMut(u8),
) -> Result<(), DropFailure> {
    let total = u32::try_from(archives.len()).unwrap_or(u32::MAX);
    for (index, path) in archives.iter().enumerate() {
        let index = u32::try_from(index).unwrap_or(u32::MAX);
        let mut scaled = |percent: u8| {
            let overall = (index * 100 + u32::from(percent)) / total;
            progress(u8::try_from(overall).unwrap_or(100));
        };
        archive::unzip(path, cancel, &mut scaled).map_err(|error| archive_failure(&error))?;
    }
    progress(100);
    Ok(())
}

fn kind_of(action: &DropAction, folder: Option<&DropFolder>) -> DropActionKind {
    match action {
        DropAction::Share => DropActionKind::Share,
        DropAction::Folder { .. } => match folder.map(|f| f.mode) {
            Some(TransferMode::Move) => DropActionKind::Move,
            _ => DropActionKind::Copy,
        },
        DropAction::CopyTo { .. } => DropActionKind::Copy,
        DropAction::MoveTo { .. } => DropActionKind::Move,
        DropAction::OpenWith => DropActionKind::OpenWith,
        DropAction::Zip => DropActionKind::Zip,
        DropAction::Unzip => DropActionKind::Unzip,
        DropAction::Reveal => DropActionKind::Reveal,
        DropAction::Trash => DropActionKind::Trash,
        DropAction::Eject => DropActionKind::Eject,
    }
}

/// Actions that report a percentage.
const fn has_progress(kind: DropActionKind) -> bool {
    matches!(kind, DropActionKind::Zip | DropActionKind::Unzip)
}

/// Actions worth an activity in the strip while they run; the rest finish in milliseconds
/// or put up a dialog of their own.
const fn is_long_running(kind: DropActionKind) -> bool {
    matches!(
        kind,
        DropActionKind::Zip | DropActionKind::Unzip | DropActionKind::Copy | DropActionKind::Move
    )
}

fn failure_of(error: &PlatformError) -> DropFailure {
    match error {
        PlatformError::Cancelled(_) => DropFailure::Cancelled,
        PlatformError::NotFound(_) => DropFailure::NotFound,
        PlatformError::Unsupported(_) => DropFailure::Unsupported,
        PlatformError::Os { .. } | PlatformError::AccessDenied(_) => DropFailure::Failed,
    }
}

fn archive_failure(error: &archive::ArchiveError) -> DropFailure {
    match error {
        archive::ArchiveError::Cancelled => DropFailure::Cancelled,
        archive::ArchiveError::NotAnArchive => DropFailure::NoArchive,
        archive::ArchiveError::Empty => DropFailure::NotFound,
        archive::ArchiveError::Io(_) | archive::ArchiveError::Zip(_) => DropFailure::Failed,
    }
}

/// Keeps every running job and the last [`KEPT_JOBS`] finished ones.
fn trim_finished(jobs: &mut Vec<TrackedJob>) {
    let finished = jobs
        .iter()
        .filter(|t| !matches!(t.job.state, DropJobState::Running { .. }))
        .count();
    let mut to_drop = finished.saturating_sub(KEPT_JOBS);
    jobs.retain(|t| {
        if to_drop > 0 && !matches!(t.job.state, DropJobState::Running { .. }) {
            to_drop -= 1;
            false
        } else {
            true
        }
    });
}

fn activity_id(job: u32) -> String {
    format!("{ID}:job-{job}")
}

/// The strip while a long job runs: its glyph, the progress track when known.
#[must_use]
pub fn running_activity(
    job: u32,
    kind: DropActionKind,
    count: u32,
    percent: Option<u8>,
) -> Activity {
    Activity {
        id: activity_id(job),
        module: ID.into(),
        priority: priority::DROP_JOB,
        leading: Some(Leading::Icon {
            glyph: kind.glyph(),
            tint: None,
        }),
        trailing: percent.map(|percent| Trailing::Progress { percent }),
        wide: Some(StripMessage::DropRunning {
            action: kind,
            count,
        }),
    }
}

/// The confirmation pulse (docs/06-motion-spec.md "Drop actions"); default hold.
#[must_use]
pub fn finished_notice(job: u32, kind: DropActionKind, count: u32) -> Notice {
    Notice {
        id: format!("{ID}:done-{job}"),
        module: ID.into(),
        priority: priority::DROP_JOB,
        leading: Some(Leading::Icon {
            glyph: kind.glyph(),
            tint: None,
        }),
        trailing: None,
        wide: Some(StripMessage::DropFinished {
            action: kind,
            count,
        }),
        hold_ms: 0,
    }
}

/// A failure notice; the reason stays in the log and the UI phrases the action.
#[must_use]
pub fn failed_notice(job: u32, kind: DropActionKind) -> Notice {
    Notice {
        id: format!("{ID}:failed-{job}"),
        module: ID.into(),
        priority: priority::DROP_JOB,
        leading: Some(Leading::Icon {
            glyph: kind.glyph(),
            tint: Some(muna_core::Tint::Red),
        }),
        trailing: None,
        wide: Some(StripMessage::DropFailed { action: kind }),
        hold_ms: 0,
    }
}

/// The backend: nothing to subscribe to — drags arrive through the shell, actions through
/// IPC — but the registry is where the module is named and owns the `Drop` surface.
#[derive(Debug)]
pub struct DropActionsModule(pub Arc<DropActionsService>);

impl ModuleBackend for DropActionsModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Drop]
    }

    fn start(&self, _ctx: ModuleCtx) -> anyhow::Result<()> {
        Ok(())
    }
}
