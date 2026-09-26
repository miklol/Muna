//! The `drop-actions` module (docs/modules/drop-actions.md, M4-E1): the settings namespace,
//! the session → job flow against `FakePlatform`, the strip activity and notices, and the zip
//! and unzip archive on a temp folder. Integration tests because the `muna` lib cannot host
//! unit tests (Common Controls manifest on Tauri-linked tests).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use muna_core::activities::StripSink;
use muna_core::{
    Clock, DropActionKind, FakeClock, Hub, Settings, StripContent, StripMessage, Trailing,
};
use muna_lib::modules::drop_actions::archive::{self, ArchiveError};
use muna_lib::modules::drop_actions::{
    DropAction, DropActionsService, DropActionsSettings, DropActionsSnapshot, DropError,
    DropFailure, DropFolder, DropJobState, DropSink, DropTile, ID, KEPT_JOBS, MAX_FOLDERS,
    TILES_PER_ROW, TILES_PER_ROW_EXPANDED, WindowThread,
};
use muna_lib::modules::{ModuleCtx, ModuleServices, Surface, backends};
use muna_platform::{
    FakePlatform, FileOpsCall, Platform, PlatformError, TransferMode, WindowHandle,
};
use parking_lot::Mutex;

const WINDOW: &str = "notch";

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<DropActionsSnapshot>>,
}

impl DropSink for RecordingSink {
    fn changed(&self, snapshot: &DropActionsSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

#[derive(Default)]
struct StripRecorder {
    seen: Mutex<Vec<StripContent>>,
}

impl StripSink for StripRecorder {
    fn strip_changed(&self, content: &StripContent) {
        self.seen.lock().push(content.clone());
    }
}

/// Runs the job inline with a fixed handle, standing in for the main thread.
struct InlineWindowThread {
    handle: WindowHandle,
    labels: Mutex<Vec<String>>,
}

impl WindowThread for InlineWindowThread {
    fn run(&self, label: &str, job: Box<dyn FnOnce(WindowHandle) + Send + 'static>) {
        self.labels.lock().push(label.to_owned());
        job(self.handle);
    }
}

struct Harness {
    platform: Arc<FakePlatform>,
    hub: Arc<Hub>,
    service: Arc<DropActionsService>,
    sink: Arc<RecordingSink>,
    strip: Arc<StripRecorder>,
}

fn harness() -> Harness {
    let platform = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new()) as Arc<dyn Clock>;
    let hub = Arc::new(Hub::new(clock));
    let strip = Arc::new(StripRecorder::default());
    hub.add_sink(Arc::clone(&strip) as Arc<dyn StripSink>);
    let service = Arc::new(DropActionsService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        Arc::clone(&hub),
    ));
    let sink = Arc::new(RecordingSink::default());
    service.set_sink(Arc::clone(&sink) as Arc<dyn DropSink>);
    Harness {
        platform,
        hub,
        service,
        sink,
        strip,
    }
}

impl Harness {
    /// A drag that entered and then released `paths` over the window.
    fn dropped(&self, paths: Vec<PathBuf>) -> u32 {
        let sessions = self.service.sessions();
        let id = sessions.begin(WINDOW, paths);
        assert!(sessions.mark_dropped(id, None));
        id
    }

    fn strip_messages(&self) -> Vec<StripMessage> {
        self.strip
            .seen
            .lock()
            .iter()
            .filter_map(|content| match content {
                StripContent::Activity { activity, .. } => activity.wide.clone(),
                StripContent::Notice { notice } => notice.wide.clone(),
                StripContent::Idle => None,
            })
            .collect()
    }
}

fn document(namespace: serde_json::Value) -> Settings {
    let mut settings = Settings::default();
    settings
        .modules
        .insert(DropActionsSettings::KEY.to_owned(), namespace);
    settings
}

fn folder(id: &str, name: &str, path: &str, mode: TransferMode) -> DropFolder {
    DropFolder {
        id: id.into(),
        name: name.into(),
        path: path.into(),
        mode,
    }
}

fn items(names: &[&str]) -> Vec<PathBuf> {
    names
        .iter()
        .map(|name| PathBuf::from(format!(r"C:\in\{name}")))
        .collect()
}

fn write(path: &Path, bytes: &[u8]) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, bytes).unwrap();
}

fn names_in(archive: &Path) -> Vec<String> {
    let mut reader = zip::ZipArchive::new(fs::File::open(archive).unwrap()).unwrap();
    (0..reader.len())
        .map(|index| reader.by_index(index).unwrap().name().to_owned())
        .collect()
}

// --- registry ---------------------------------------------------------------------------

#[test]
fn the_module_is_registered_and_owns_the_drop_surface() {
    let clock = Arc::new(FakeClock::new());
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(muna_core::Store::open_in_memory().expect("store"));
    let services = ModuleServices::new(
        &platform,
        &hub,
        None,
        &store,
        &(Arc::clone(&clock) as Arc<dyn Clock>),
    );
    let backend = backends(&services)
        .into_iter()
        .find(|backend| backend.id() == ID)
        .expect("drop actions are registered");
    assert_eq!(backend.capabilities(), &[Surface::Drop]);
    backend
        .start(ModuleCtx {
            platform: Arc::clone(&platform),
            activities: Arc::clone(&hub),
        })
        .expect("nothing to start");
    assert_eq!(
        services.drop_actions.settings(),
        DropActionsSettings::default()
    );
    assert!(services.drop_actions.sessions().is_empty());
}

// --- settings ----------------------------------------------------------------------------

#[test]
fn defaults_list_every_built_in_tile_share_first_and_destructive_last() {
    let settings = DropActionsSettings::default();
    assert_eq!(settings.tiles.first(), Some(&DropTile::NearbyShare));
    assert_eq!(settings.tiles.get(1), Some(&DropTile::Shelf));
    assert_eq!(
        &settings.tiles[settings.tiles.len() - 2..],
        &[DropTile::Trash, DropTile::Eject]
    );
    assert_eq!(settings.tiles.len(), 10);
    assert!(settings.folders.is_empty());
    assert!(!settings.expand_notch);
    assert_eq!(settings.tiles_per_row(), TILES_PER_ROW);
    assert_eq!(
        DropActionsSettings {
            expand_notch: true,
            ..DropActionsSettings::default()
        }
        .tiles_per_row(),
        TILES_PER_ROW_EXPANDED
    );
}

#[test]
fn a_missing_or_malformed_namespace_yields_the_defaults() {
    assert_eq!(
        DropActionsSettings::from_document(&Settings::default()),
        DropActionsSettings::default()
    );
    assert_eq!(
        DropActionsSettings::from_document(&document(serde_json::json!({ "tiles": 12 }))),
        DropActionsSettings::default()
    );
    assert_eq!(
        DropActionsSettings::from_document(&document(serde_json::json!({ "unknown": true }))),
        DropActionsSettings::default(),
        "unknown keys are ignored, missing ones default"
    );
}

#[test]
fn settings_round_trip_through_the_document() {
    let settings = DropActionsSettings {
        tiles: vec![
            DropTile::Folder { id: "one".into() },
            DropTile::Divider,
            DropTile::Zip,
            DropTile::Divider,
            DropTile::Trash,
        ],
        folders: vec![folder(
            "one",
            "Drive",
            r"C:\Users\me\Drive",
            TransferMode::Move,
        )],
        expand_notch: true,
    };
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    let json = &document.modules[DropActionsSettings::KEY];
    assert_eq!(
        json["tiles"][0],
        serde_json::json!({ "kind": "folder", "id": "one" })
    );
    assert_eq!(json["folders"][0]["mode"], serde_json::json!("move"));
    assert_eq!(json["expandNotch"], serde_json::json!(true));
    assert_eq!(DropActionsSettings::from_document(&document), settings);
}

#[test]
fn normalising_repairs_folders_and_the_tile_row() {
    let settings = DropActionsSettings {
        tiles: vec![
            DropTile::Zip,
            DropTile::Divider,
            DropTile::Folder { id: "gone".into() },
            DropTile::Zip,
            DropTile::Divider,
            DropTile::Folder { id: "one".into() },
        ],
        folders: vec![
            folder("one", "", r"C:\Users\me\OneDrive\", TransferMode::Copy),
            folder("one", "Twin", r"C:\twin", TransferMode::Move),
            folder(" ", "No id", r"C:\nowhere", TransferMode::Copy),
            folder("two", "Empty path", "  ", TransferMode::Copy),
            folder("three", "Projects", "D:/work/projects", TransferMode::Move),
        ],
        expand_notch: false,
    }
    .normalised();

    assert_eq!(
        settings.folders,
        vec![
            folder(
                "one",
                "OneDrive",
                r"C:\Users\me\OneDrive\",
                TransferMode::Copy
            ),
            folder("three", "Projects", "D:/work/projects", TransferMode::Move),
        ],
        "first id wins, blank ids and paths drop, names come from the last segment; the path \
         itself is kept verbatim (trimming a separator would turn `C:\\` into `C:`)"
    );
    assert_eq!(
        settings.tiles,
        vec![
            DropTile::Zip,
            DropTile::Divider,
            DropTile::Divider,
            DropTile::Folder { id: "one".into() },
            DropTile::Folder { id: "three".into() },
        ],
        "duplicates and orphan folder tiles go, dividers stay, missing folder tiles append"
    );
    assert_eq!(
        settings.folder("three").map(|f| f.name.as_str()),
        Some("Projects")
    );
    assert_eq!(settings.folder("gone"), None);
}

#[test]
fn folders_are_capped() {
    let folders: Vec<DropFolder> = (0..MAX_FOLDERS + 3)
        .map(|index| {
            folder(
                &format!("f{index}"),
                "",
                &format!(r"C:\f{index}"),
                TransferMode::Copy,
            )
        })
        .collect();
    let settings = DropActionsSettings {
        tiles: Vec::new(),
        folders,
        expand_notch: false,
    }
    .normalised();
    assert_eq!(settings.folders.len(), MAX_FOLDERS);
    assert_eq!(
        settings.tiles.len(),
        MAX_FOLDERS,
        "one tile per kept folder"
    );
}

#[test]
fn applying_settings_tells_the_sink_once_per_change() {
    let h = harness();
    let document = document(serde_json::json!({
        "tiles": [{ "kind": "trash" }],
        "folders": [{ "id": "one", "name": "", "path": r"C:\Users\me\Drive", "mode": "copy" }],
        "expandNotch": true
    }));
    h.service.apply_settings(&document);
    h.service.apply_settings(&document);
    let snapshots = h.sink.snapshots.lock();
    assert_eq!(
        snapshots.len(),
        1,
        "an unchanged document is not re-emitted"
    );
    let snapshot = &snapshots[0];
    assert_eq!(
        snapshot.settings.tiles,
        vec![DropTile::Trash, DropTile::Folder { id: "one".into() }]
    );
    assert_eq!(snapshot.settings.folders[0].name, "Drive");
    assert!(snapshot.settings.expand_notch);
    assert!(snapshot.jobs.is_empty());
    assert_eq!(h.service.snapshot(), *snapshot);
}

// --- sessions ----------------------------------------------------------------------------

#[test]
fn running_needs_a_session_whose_items_were_released_over_the_window() {
    let h = harness();
    assert_eq!(
        h.service.run(42, &DropAction::Reveal),
        Err(DropError::UnknownSession)
    );
    let session = h.service.sessions().begin(WINDOW, items(&["a.txt"]));
    assert_eq!(
        h.service.run(session, &DropAction::Reveal),
        Err(DropError::NotDropped),
        "a drag that is still over the window has nothing to act on"
    );
    assert!(h.platform.file_ops_calls().is_empty());
    assert!(
        h.service.sessions().get(session).is_some(),
        "a refused run keeps the session for a later drop"
    );
}

#[test]
fn a_folder_tile_needs_a_configured_folder() {
    let h = harness();
    let session = h.dropped(items(&["a.txt"]));
    assert_eq!(
        h.service
            .run(session, &DropAction::Folder { id: "nope".into() }),
        Err(DropError::UnknownFolder)
    );
    assert!(h.service.sessions().get(session).is_some());
}

#[test]
fn cancelling_a_session_forgets_its_items() {
    let h = harness();
    let session = h.dropped(items(&["a.txt"]));
    assert!(h.service.cancel_session(session));
    assert!(!h.service.cancel_session(session), "already gone");
    assert_eq!(
        h.service.run(session, &DropAction::Reveal),
        Err(DropError::UnknownSession)
    );
    assert!(h.service.sessions().is_empty());
}

// --- actions against the fake platform --------------------------------------------------

#[test]
fn trash_recycles_every_item_and_pulses_a_confirmation() {
    let h = harness();
    let paths = items(&["a.txt", "b.txt"]);
    let session = h.dropped(paths.clone());

    let job = h.service.run(session, &DropAction::Trash).unwrap();

    assert_eq!(job.id, 1);
    assert_eq!(job.action, DropActionKind::Trash);
    assert_eq!(job.count, 2);
    assert_eq!(job.state, DropJobState::Done);
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::Recycle(paths)]
    );
    assert!(h.service.sessions().is_empty(), "the session is consumed");
    assert_eq!(
        h.strip_messages(),
        vec![StripMessage::DropFinished {
            action: DropActionKind::Trash,
            count: 2,
        }],
        "a short action shows no running activity, only the confirmation notice"
    );
    let snapshots = h.sink.snapshots.lock();
    assert_eq!(snapshots.len(), 2, "started, then finished");
    assert_eq!(
        snapshots[0].jobs[0].state,
        DropJobState::Running { percent: None }
    );
    assert_eq!(snapshots[1].jobs, vec![job]);
}

#[test]
fn a_configured_folder_transfers_with_its_mode_and_shows_an_activity_while_it_runs() {
    let h = harness();
    h.service.apply_settings(&document(serde_json::json!({
        "folders": [{ "id": "drive", "name": "Drive", "path": r"C:\Users\me\Drive", "mode": "move" }]
    })));
    let paths = items(&["a.txt", "b.txt", "c.txt"]);
    let session = h.dropped(paths.clone());

    let job = h
        .service
        .run(session, &DropAction::Folder { id: "drive".into() })
        .unwrap();

    assert_eq!(job.action, DropActionKind::Move);
    assert_eq!(job.state, DropJobState::Done);
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::Transfer {
            items: paths,
            destination: PathBuf::from(r"C:\Users\me\Drive"),
            mode: TransferMode::Move,
        }]
    );
    assert_eq!(
        h.strip_messages(),
        vec![
            StripMessage::DropRunning {
                action: DropActionKind::Move,
                count: 3,
            },
            StripMessage::DropFinished {
                action: DropActionKind::Move,
                count: 3,
            },
        ]
    );
    assert!(
        h.hub.activities().is_empty(),
        "the running activity is retracted when the job ends"
    );
}

#[test]
fn copy_to_and_move_to_ask_for_a_folder_with_the_tile_title() {
    let h = harness();
    h.platform
        .set_picked_folder(Some(PathBuf::from(r"D:\picked")));
    let paths = items(&["a.txt"]);

    let session = h.dropped(paths.clone());
    let copy = h
        .service
        .run(
            session,
            &DropAction::CopyTo {
                title: "Copy to…".into(),
            },
        )
        .unwrap();
    let session = h.dropped(paths.clone());
    let moved = h
        .service
        .run(session, &DropAction::MoveTo { title: "  ".into() })
        .unwrap();

    assert_eq!(copy.action, DropActionKind::Copy);
    assert_eq!(moved.action, DropActionKind::Move);
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![
            FileOpsCall::PickFolder(0, "Copy to…".into()),
            FileOpsCall::Transfer {
                items: paths.clone(),
                destination: PathBuf::from(r"D:\picked"),
                mode: TransferMode::Copy,
            },
            FileOpsCall::PickFolder(0, "Move to".into()),
            FileOpsCall::Transfer {
                items: paths,
                destination: PathBuf::from(r"D:\picked"),
                mode: TransferMode::Move,
            },
        ],
        "a blank title falls back to the built-in caption"
    );
}

#[test]
fn a_dismissed_picker_cancels_quietly() {
    let h = harness();
    let session = h.dropped(items(&["a.txt"]));

    let job = h
        .service
        .run(
            session,
            &DropAction::CopyTo {
                title: String::new(),
            },
        )
        .unwrap();

    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::Cancelled,
        }
    );
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::PickFolder(0, "Copy to".into())]
    );
    assert!(
        h.strip_messages().is_empty(),
        "nothing is copying while the picker is up, and a cancel shows no notice"
    );
}

#[test]
fn a_platform_failure_shows_a_red_notice_and_maps_the_reason() {
    let h = harness();
    h.platform
        .set_file_ops_error(Some(PlatformError::NotFound("removable volume".into())));
    let session = h.dropped(items(&["a.txt", "b.txt"]));

    let job = h.service.run(session, &DropAction::Eject).unwrap();

    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::NotFound,
        }
    );
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::Eject(PathBuf::from(r"C:\in\a.txt"))],
        "eject acts on the first item only"
    );
    assert_eq!(
        h.strip_messages(),
        vec![StripMessage::DropFailed {
            action: DropActionKind::Eject,
        }]
    );
    let leading = {
        let seen = h.strip.seen.lock();
        let StripContent::Notice { notice } = seen.last().unwrap() else {
            panic!("a failure is a notice");
        };
        assert_eq!(notice.priority, muna_core::activities::priority::DROP_JOB);
        notice.leading.clone()
    };
    assert_eq!(
        leading,
        Some(muna_core::Leading::Icon {
            glyph: muna_core::Glyph::Drive,
            tint: Some(muna_core::Tint::Red),
        })
    );

    h.platform
        .set_file_ops_error(Some(PlatformError::Unsupported("share sheet")));
    let session = h.dropped(items(&["a.txt"]));
    let job = h.service.run(session, &DropAction::Share).unwrap();
    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::Unsupported,
        }
    );

    h.platform.set_file_ops_error(Some(PlatformError::Os {
        api: "IFileOperation",
        code: 5,
    }));
    let session = h.dropped(items(&["a.txt"]));
    let job = h.service.run(session, &DropAction::Reveal).unwrap();
    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::Failed,
        }
    );
}

#[test]
fn share_runs_on_the_window_thread_with_the_window_handle() {
    let h = harness();
    let thread = Arc::new(InlineWindowThread {
        handle: 0x1234,
        labels: Mutex::new(Vec::new()),
    });
    h.service
        .set_window_thread(Arc::clone(&thread) as Arc<dyn WindowThread>);
    let paths = items(&["a.txt", "b.txt"]);
    let session = h.dropped(paths.clone());

    let job = h.service.run(session, &DropAction::Share).unwrap();

    assert_eq!(job.state, DropJobState::Done);
    assert_eq!(thread.labels.lock().clone(), vec![WINDOW.to_owned()]);
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::Share(0x1234, paths)]
    );
}

#[test]
fn share_falls_back_to_no_window_when_none_is_wired() {
    let h = harness();
    let paths = items(&["a.txt"]);
    let session = h.dropped(paths.clone());
    let job = h.service.run(session, &DropAction::Share).unwrap();
    assert_eq!(job.state, DropJobState::Done);
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![FileOpsCall::Share(0, paths)]
    );
}

#[test]
fn open_with_and_eject_take_the_first_item_reveal_takes_all() {
    let h = harness();
    let paths = items(&["a.txt", "b.txt"]);
    for action in [DropAction::OpenWith, DropAction::Reveal, DropAction::Eject] {
        let session = h.dropped(paths.clone());
        assert_eq!(
            h.service.run(session, &action).unwrap().state,
            DropJobState::Done
        );
    }
    assert_eq!(
        h.platform.file_ops_calls(),
        vec![
            FileOpsCall::OpenWith(PathBuf::from(r"C:\in\a.txt")),
            FileOpsCall::Reveal(paths),
            FileOpsCall::Eject(PathBuf::from(r"C:\in\a.txt")),
        ]
    );
}

#[test]
fn the_snapshot_keeps_the_last_few_finished_jobs() {
    let h = harness();
    for _ in 0..KEPT_JOBS + 3 {
        let session = h.dropped(items(&["a.txt"]));
        h.service.run(session, &DropAction::Reveal).unwrap();
    }
    let jobs = h.service.snapshot().jobs;
    assert_eq!(jobs.len(), KEPT_JOBS);
    let total = u32::try_from(KEPT_JOBS + 3).unwrap();
    let kept = u32::try_from(KEPT_JOBS).unwrap();
    assert_eq!(
        jobs.first().map(|job| job.id),
        Some(total - kept + 1),
        "the oldest finished jobs are trimmed first"
    );
    assert_eq!(jobs.last().map(|job| job.id), Some(total));
}

#[test]
fn cancelling_an_unknown_or_finished_job_is_a_no_op() {
    let h = harness();
    assert!(!h.service.cancel_job(1));
    let session = h.dropped(items(&["a.txt"]));
    let job = h.service.run(session, &DropAction::Reveal).unwrap();
    assert!(!h.service.cancel_job(job.id), "already finished");
}

// --- zip and unzip through the service ----------------------------------------------------

#[test]
fn zip_archives_the_dropped_items_with_progress_and_unzip_restores_them() {
    let h = harness();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    write(
        &root.join("Photos").join("2024").join("a.jpg"),
        &vec![1_u8; 70_000],
    );
    write(&root.join("Photos").join("b.txt"), b"hello");
    write(&root.join("notes.md"), b"# notes");
    let paths = vec![root.join("Photos"), root.join("notes.md")];
    let session = h.dropped(paths);

    let job = h.service.run(session, &DropAction::Zip).unwrap();

    assert_eq!(job.action, DropActionKind::Zip);
    assert_eq!(job.count, 2);
    assert_eq!(job.state, DropJobState::Done);
    let archive = root.join("Archive.zip");
    assert!(archive.is_file(), "several items make `Archive.zip`");
    assert_eq!(
        names_in(&archive),
        vec![
            "Photos/",
            "Photos/2024/",
            "Photos/2024/a.jpg",
            "Photos/b.txt",
            "notes.md"
        ],
        "names are relative to the item's parent, folders first in sorted order"
    );
    let messages = h.strip_messages();
    assert_eq!(
        messages.first(),
        Some(&StripMessage::DropRunning {
            action: DropActionKind::Zip,
            count: 2,
        })
    );
    assert_eq!(
        messages.last(),
        Some(&StripMessage::DropFinished {
            action: DropActionKind::Zip,
            count: 2,
        })
    );
    let seen = h.strip.seen.lock();
    let percents: Vec<u8> = seen
        .iter()
        .filter_map(|content| match content {
            StripContent::Activity { activity, .. } => match activity.trailing {
                Some(Trailing::Progress { percent }) => Some(percent),
                _ => None,
            },
            _ => None,
        })
        .collect();
    assert_eq!(percents.first(), Some(&0));
    assert_eq!(percents.last(), Some(&100));
    assert!(
        percents.windows(2).all(|pair| pair[0] <= pair[1]),
        "progress only ever grows: {percents:?}"
    );
    drop(seen);
    let snapshots = h.sink.snapshots.lock();
    assert!(
        snapshots.iter().any(|snapshot| {
            snapshot.jobs.iter().any(|job| {
                matches!(
                    job.state,
                    DropJobState::Running {
                        percent: Some(1..=99)
                    }
                )
            })
        }),
        "the UI sees intermediate percentages"
    );
    drop(snapshots);

    // Unzip beside the archive: the folder is named after it, contents intact, and only the
    // archive counts.
    let session = h.dropped(vec![archive.clone(), root.join("notes.md")]);
    let job = h.service.run(session, &DropAction::Unzip).unwrap();
    assert_eq!(job.action, DropActionKind::Unzip);
    assert_eq!(job.count, 1);
    assert_eq!(job.state, DropJobState::Done);
    let unpacked = root.join("Archive");
    assert_eq!(
        fs::read(unpacked.join("Photos").join("2024").join("a.jpg")).unwrap(),
        vec![1_u8; 70_000]
    );
    assert_eq!(fs::read(unpacked.join("notes.md")).unwrap(), b"# notes");
    assert!(
        h.platform.file_ops_calls().is_empty(),
        "archives never go through the shell"
    );
}

#[test]
fn unzip_without_an_archive_among_the_items_fails_as_no_archive() {
    let h = harness();
    let dir = tempfile::tempdir().unwrap();
    write(&dir.path().join("a.txt"), b"a");
    let session = h.dropped(vec![dir.path().join("a.txt")]);
    let job = h.service.run(session, &DropAction::Unzip).unwrap();
    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::NoArchive,
        }
    );
    assert_eq!(
        h.strip_messages(),
        vec![StripMessage::DropFailed {
            action: DropActionKind::Unzip,
        }]
    );
}

#[test]
fn zipping_a_missing_item_fails_without_leaving_an_archive_behind() {
    let h = harness();
    let dir = tempfile::tempdir().unwrap();
    let session = h.dropped(vec![dir.path().join("missing.txt")]);
    let job = h.service.run(session, &DropAction::Zip).unwrap();
    assert_eq!(
        job.state,
        DropJobState::Failed {
            reason: DropFailure::Failed,
        }
    );
    assert!(!dir.path().join("missing.zip").exists());
}

// --- the archive itself --------------------------------------------------------------------

fn no_cancel() -> AtomicBool {
    AtomicBool::new(false)
}

#[test]
fn a_single_item_is_named_after_itself_and_copies_never_overwrite() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.pdf");
    write(&file, b"pdf");
    let cancel = no_cancel();
    let mut reports = Vec::new();

    let first = archive::zip(std::slice::from_ref(&file), &cancel, &mut |p| {
        reports.push(p);
    })
    .unwrap();
    let second = archive::zip(std::slice::from_ref(&file), &cancel, &mut |_| {}).unwrap();
    let third = archive::zip(&[file], &cancel, &mut |_| {}).unwrap();

    assert_eq!(first, dir.path().join("report.zip"));
    assert_eq!(second, dir.path().join("report (2).zip"));
    assert_eq!(third, dir.path().join("report (3).zip"));
    assert_eq!(names_in(&first), vec!["report.pdf"]);
    assert_eq!(reports, vec![100], "one small file jumps straight to done");
}

#[test]
fn unzipping_names_the_folder_after_the_archive_and_never_overwrites() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("report.pdf");
    write(&file, b"pdf");
    let cancel = no_cancel();
    let archive = archive::zip(&[file], &cancel, &mut |_| {}).unwrap();

    let first = archive::unzip(&archive, &cancel, &mut |_| {}).unwrap();
    let second = archive::unzip(&archive, &cancel, &mut |_| {}).unwrap();

    assert_eq!(first, dir.path().join("report"));
    assert_eq!(second, dir.path().join("report (2)"));
    assert_eq!(fs::read(first.join("report.pdf")).unwrap(), b"pdf");
    assert_eq!(fs::read(second.join("report.pdf")).unwrap(), b"pdf");
}

#[test]
fn an_empty_folder_zips_as_a_directory_entry() {
    let dir = tempfile::tempdir().unwrap();
    let empty = dir.path().join("Empty");
    fs::create_dir(&empty).unwrap();
    let cancel = no_cancel();
    let archive = archive::zip(&[empty], &cancel, &mut |_| {}).unwrap();
    assert_eq!(names_in(&archive), vec!["Empty/"]);
    let unpacked = archive::unzip(&archive, &cancel, &mut |_| {}).unwrap();
    assert!(unpacked.join("Empty").is_dir());
}

#[test]
fn zipping_nothing_is_an_error() {
    let cancel = no_cancel();
    assert!(matches!(
        archive::zip(&[], &cancel, &mut |_| {}),
        Err(ArchiveError::Empty)
    ));
}

#[test]
fn cancelling_mid_way_removes_the_partial_archive() {
    let dir = tempfile::tempdir().unwrap();
    let big = dir.path().join("big.bin");
    write(&big, &vec![7_u8; 300_000]);
    let cancel = no_cancel();
    let mut report = |percent: u8| {
        if percent >= 20 {
            cancel.store(true, Ordering::Relaxed);
        }
    };

    let result = archive::zip(std::slice::from_ref(&big), &cancel, &mut report);

    assert!(matches!(result, Err(ArchiveError::Cancelled)), "{result:?}");
    assert!(
        !dir.path().join("big.zip").exists(),
        "a cancelled archive leaves nothing behind"
    );
}

#[test]
fn cancelling_an_extraction_removes_the_partial_folder() {
    let dir = tempfile::tempdir().unwrap();
    let big = dir.path().join("big.bin");
    write(&big, &vec![7_u8; 300_000]);
    let cancel = no_cancel();
    let archive = archive::zip(&[big], &cancel, &mut |_| {}).unwrap();
    let mut report = |percent: u8| {
        if percent >= 20 {
            cancel.store(true, Ordering::Relaxed);
        }
    };

    let result = archive::unzip(&archive, &cancel, &mut report);

    assert!(matches!(result, Err(ArchiveError::Cancelled)), "{result:?}");
    assert!(!dir.path().join("big").exists());
}

#[test]
fn unzip_refuses_files_that_are_not_archives_and_skips_escaping_entries() {
    let dir = tempfile::tempdir().unwrap();
    let text = dir.path().join("a.txt");
    write(&text, b"a");
    let cancel = no_cancel();
    assert!(matches!(
        archive::unzip(&text, &cancel, &mut |_| {}),
        Err(ArchiveError::NotAnArchive)
    ));
    assert!(!archive::is_archive(&text));
    assert!(archive::is_archive(Path::new(r"C:\x\Archive.ZIP")));

    // A hand-made archive with an entry that climbs out of its folder.
    let evil = dir.path().join("evil.zip");
    {
        let mut writer = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("../escape.txt", options).unwrap();
        std::io::Write::write_all(&mut writer, b"nope").unwrap();
        writer.start_file("safe.txt", options).unwrap();
        std::io::Write::write_all(&mut writer, b"ok").unwrap();
        writer.finish().unwrap();
    }
    let unpacked = archive::unzip(&evil, &cancel, &mut |_| {}).unwrap();
    assert_eq!(unpacked, dir.path().join("evil"));
    assert_eq!(fs::read(unpacked.join("safe.txt")).unwrap(), b"ok");
    assert!(!dir.path().join("escape.txt").exists());
    assert!(!unpacked.join("escape.txt").exists());
}
