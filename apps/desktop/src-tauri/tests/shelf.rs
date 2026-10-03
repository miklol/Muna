//! The `shelf` module (docs/modules/shelf.md, M4-E2): the settings namespace, items arriving
//! through the Drop actions *Shelf* tile and as text, the snapshot the panel sees (never a
//! path), drag-out and *Copy* payloads, thumbnails, storage copies, the missing state and
//! expiry — all against `FakePlatform` and an in-memory store. Integration tests because the
//! `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked tests).

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use muna_core::{
    Clock, DropActionKind, FakeClock, Hub, Settings, ShelfIntake, ShelfIntakeError, ShelfItemKind,
    Store,
};
use muna_lib::modules::drop_actions::{DropAction, DropJobState, DropTile};
use muna_lib::modules::shelf::{
    ID, MAX_EXPIRY_DAYS, PREVIEW_CHARS, ShelfCommand, ShelfError, ShelfService, ShelfSettings,
    ShelfSink, ShelfSnapshot, THUMBNAIL_SIZE,
};
use muna_lib::modules::{ModuleCtx, ModuleServices, Surface, backends};
use muna_platform::{
    DragPayload, FakePlatform, FileOpsCall, Platform, PlatformError, TransferMode,
};
use parking_lot::Mutex;

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<ShelfSnapshot>>,
}

impl ShelfSink for RecordingSink {
    fn changed(&self, snapshot: &ShelfSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

struct Harness {
    platform: Arc<FakePlatform>,
    clock: Arc<FakeClock>,
    service: Arc<ShelfService>,
    sink: Arc<RecordingSink>,
    /// The profile folder; Shelf storage is `shelf/` inside it.
    profile: tempfile::TempDir,
}

impl Harness {
    fn storage(&self) -> PathBuf {
        self.profile.path().join("shelf")
    }

    fn file(&self, name: &str, contents: &str) -> PathBuf {
        let path = self.profile.path().join(name);
        fs::write(&path, contents).unwrap();
        path
    }

    fn set_settings(&self, settings: &ShelfSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).unwrap();
        self.service.apply_settings(&document);
    }

    fn snapshots(&self) -> usize {
        self.sink.snapshots.lock().len()
    }
}

fn harness() -> Harness {
    let platform = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::new());
    let store = Arc::new(Store::open_in_memory().unwrap());
    let profile = tempfile::tempdir().unwrap();
    let service = Arc::new(ShelfService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        store,
        Arc::clone(&clock) as Arc<dyn Clock>,
        Some(profile.path().join("shelf")),
    ));
    let sink = Arc::new(RecordingSink::default());
    service.set_sink(Arc::clone(&sink) as Arc<dyn ShelfSink>);
    Harness {
        platform,
        clock,
        service,
        sink,
        profile,
    }
}

fn names(snapshot: &ShelfSnapshot) -> Vec<&str> {
    snapshot
        .items
        .iter()
        .map(|item| item.name.as_str())
        .collect()
}

// --- registry ------------------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_a_panel_and_feeds_the_shelf_tile() {
    let platform = Arc::new(FakePlatform::new()) as Arc<dyn Platform>;
    let clock = Arc::new(FakeClock::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().unwrap());
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
        .expect("the shelf is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel]);
    assert_eq!(services.shelf.settings(), ShelfSettings::default());

    // The default row carries the Shelf tile, and dropping on it parks the items.
    assert!(
        services
            .drop_actions
            .settings()
            .tiles
            .contains(&DropTile::Shelf)
    );
    let sessions = services.drop_actions.sessions();
    let session = sessions.begin("notch", vec![PathBuf::from("C:\\docs\\a.txt")]);
    sessions.mark_dropped(session, None);
    let job = services
        .drop_actions
        .run(session, &DropAction::Shelf)
        .unwrap();
    assert_eq!(job.action, DropActionKind::Shelf);
    assert_eq!(job.state, DropJobState::Done);
    assert_eq!(
        names(&services.shelf.snapshot().unwrap()),
        ["a.txt"],
        "the tile reached the shelf through the core trait"
    );

    // `start` only schedules the hourly sweep on Tauri's runtime.
    backend
        .start(ModuleCtx {
            platform: Arc::clone(&platform),
            activities: Arc::clone(&hub),
        })
        .expect("the sweep is scheduled");
}

// --- settings ------------------------------------------------------------------------------

#[test]
fn settings_default_to_references_that_never_expire_and_are_capped() {
    let defaults = ShelfSettings::default();
    assert!(!defaults.copy_into_storage);
    assert_eq!(defaults.expiry_days, 0);
    assert_eq!(defaults.expiry_ms(), None);

    let mut document = Settings::default();
    ShelfSettings {
        copy_into_storage: true,
        expiry_days: 900,
    }
    .write(&mut document)
    .unwrap();
    let read = ShelfSettings::from_document(&document);
    assert!(read.copy_into_storage);
    assert_eq!(read.expiry_days, MAX_EXPIRY_DAYS);
    assert_eq!(
        read.expiry_ms(),
        Some(i64::from(MAX_EXPIRY_DAYS) * 86_400_000)
    );

    let mut broken = Settings::default();
    broken
        .modules
        .insert(ID.into(), serde_json::json!({ "expiryDays": "soon" }));
    assert_eq!(
        ShelfSettings::from_document(&broken),
        ShelfSettings::default()
    );
    assert_eq!(
        ShelfSettings::from_document(&Settings::default()),
        ShelfSettings::default()
    );
}

#[test]
fn applying_settings_reports_once_per_change() {
    let h = harness();
    let wanted = ShelfSettings {
        copy_into_storage: false,
        expiry_days: 7,
    };
    h.set_settings(&wanted);
    h.set_settings(&wanted);
    assert_eq!(h.snapshots(), 1);
    assert_eq!(h.service.settings(), wanted);
    assert_eq!(h.sink.snapshots.lock()[0].settings, wanted);
}

// --- items ---------------------------------------------------------------------------------

#[test]
fn files_and_snippets_reach_the_panel_without_paths_or_full_text() {
    let h = harness();
    let report = h.file("Report.PDF", "12345");
    let folder = h.profile.path().join("photos");
    fs::create_dir(&folder).unwrap();
    let gone = h.profile.path().join("gone.txt");

    let added = h
        .service
        .add_files(&[report.clone(), folder.clone(), gone.clone()])
        .unwrap();
    assert_eq!(added, 3);
    let long = "word ".repeat(100);
    let snapshot = h
        .service
        .command(ShelfCommand::AddText { text: long.clone() })
        .unwrap();

    assert_eq!(
        names(&snapshot),
        [
            "Report.PDF",
            "photos",
            "gone.txt",
            "word word word word word word word word word word word word…"
        ]
    );
    let serialised = serde_json::to_string(&snapshot).unwrap();
    assert!(
        !serialised.contains(&*h.profile.path().to_string_lossy()),
        "no path reaches the UI"
    );

    let [report_item, folder_item, gone_item, snippet] = snapshot.items.as_slice() else {
        panic!("four items");
    };
    assert_eq!(report_item.kind, ShelfItemKind::File);
    assert_eq!(report_item.extension.as_deref(), Some("pdf"));
    assert_eq!(report_item.size, Some(5));
    assert!(!report_item.is_folder && !report_item.missing && !report_item.copied);
    assert!(folder_item.is_folder);
    assert_eq!(folder_item.size, None);
    assert!(gone_item.missing);
    assert_eq!(snippet.kind, ShelfItemKind::Text);
    assert!(snippet.preview.as_deref().unwrap().starts_with("word word"));
    assert!(snippet.preview.as_deref().unwrap().ends_with('…'));
    assert_eq!(
        snippet.preview.as_deref().unwrap().chars().count(),
        PREVIEW_CHARS + 1
    );
    assert!(
        !serialised.contains(&long),
        "a snippet is cut to its preview"
    );
    assert_eq!(h.snapshots(), 2, "one report per change");

    // Re-adding the same reference is a no-op; a blank snippet is refused.
    assert_eq!(h.service.add_files(&[report]).unwrap(), 0);
    assert!(matches!(
        h.service.command(ShelfCommand::AddText {
            text: "  \n ".into()
        }),
        Err(ShelfError::EmptyText)
    ));
    assert_eq!(h.snapshots(), 2);
}

#[test]
fn remove_clear_and_remove_missing_take_the_right_items() {
    let h = harness();
    let present = h.file("here.txt", "x");
    let gone = h.profile.path().join("gone.txt");
    h.service.add_files(&[present, gone]).unwrap();
    h.service
        .command(ShelfCommand::AddText {
            text: "note".into(),
        })
        .unwrap();
    let ids: Vec<String> = h
        .service
        .snapshot()
        .unwrap()
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect();

    let after = h.service.command(ShelfCommand::RemoveMissing).unwrap();
    assert_eq!(names(&after), ["here.txt", "note"]);

    let after = h
        .service
        .command(ShelfCommand::Remove {
            ids: vec![ids[2].clone(), "nope".into()],
        })
        .unwrap();
    assert_eq!(names(&after), ["here.txt"]);

    let before = h.snapshots();
    let after = h
        .service
        .command(ShelfCommand::Remove {
            ids: vec!["nope".into()],
        })
        .unwrap();
    assert_eq!(names(&after), ["here.txt"]);
    assert_eq!(h.snapshots(), before, "removing nothing reports nothing");

    let after = h.service.command(ShelfCommand::Clear).unwrap();
    assert!(after.items.is_empty());
}

#[test]
fn open_reveal_and_copy_go_through_the_platform() {
    let h = harness();
    let a = h.file("a.txt", "a");
    let b = h.file("b.txt", "b");
    h.service.add_files(&[a.clone(), b.clone()]).unwrap();
    h.service
        .command(ShelfCommand::AddText {
            text: "https://example.com".into(),
        })
        .unwrap();
    let ids: Vec<String> = h
        .service
        .snapshot()
        .unwrap()
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect();

    h.service
        .command(ShelfCommand::Open { id: ids[0].clone() })
        .unwrap();
    h.service
        .command(ShelfCommand::Reveal {
            ids: vec![ids[1].clone(), ids[0].clone(), ids[2].clone()],
        })
        .unwrap();
    assert_eq!(
        h.platform.file_ops_calls(),
        [
            FileOpsCall::Open(a.clone()),
            FileOpsCall::Reveal(vec![a.clone(), b.clone()])
        ],
        "reveal keeps shelf order and skips the snippet"
    );

    // Copy: files win over snippets; a lone snippet copies as text.
    h.service
        .command(ShelfCommand::Copy { ids: ids.clone() })
        .unwrap();
    h.service
        .command(ShelfCommand::Copy {
            ids: vec![ids[2].clone()],
        })
        .unwrap();
    assert_eq!(
        h.platform.clipboard_payloads(),
        [
            DragPayload::Files(vec![a, b]),
            DragPayload::Text("https://example.com".into())
        ]
    );

    // Nothing to open or carry is a typed error, not a platform call.
    assert!(matches!(
        h.service.command(ShelfCommand::Open { id: ids[2].clone() }),
        Err(ShelfError::NothingToCarry)
    ));
    assert!(matches!(
        h.service.command(ShelfCommand::Open { id: "nope".into() }),
        Err(ShelfError::UnknownItem)
    ));
    assert!(matches!(
        h.service.command(ShelfCommand::Reveal {
            ids: vec![ids[2].clone()]
        }),
        Err(ShelfError::NothingToCarry)
    ));
    assert!(matches!(
        h.service.command(ShelfCommand::Copy { ids: vec![] }),
        Err(ShelfError::UnknownItem)
    ));

    h.platform
        .set_file_ops_error(Some(PlatformError::NotFound("a.txt".into())));
    assert!(matches!(
        h.service.command(ShelfCommand::Open { id: ids[0].clone() }),
        Err(ShelfError::Platform(PlatformError::NotFound(_)))
    ));
}

#[test]
fn drag_payloads_skip_missing_files_and_join_snippets() {
    let h = harness();
    let here = h.file("here.txt", "x");
    let gone = h.profile.path().join("gone.txt");
    h.service.add_files(&[here.clone(), gone]).unwrap();
    for text in ["one", "two"] {
        h.service
            .command(ShelfCommand::AddText { text: text.into() })
            .unwrap();
    }
    let ids: Vec<String> = h
        .service
        .snapshot()
        .unwrap()
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect();

    assert_eq!(
        h.service.payload(&ids).unwrap(),
        DragPayload::Files(vec![here]),
        "present files only, snippets left out"
    );
    assert_eq!(
        h.service.payload(&ids[2..]).unwrap(),
        DragPayload::Text("one\n\ntwo".into())
    );
    assert!(matches!(
        h.service.payload(&ids[1..2]),
        Err(ShelfError::NothingToCarry)
    ));
    assert!(matches!(
        h.service.payload(&["nope".to_owned()]),
        Err(ShelfError::UnknownItem)
    ));
}

#[test]
fn thumbnails_come_from_the_shell_once_and_are_data_urls() {
    let h = harness();
    let pic = h.file("pic.png", "not really a png");
    let doc = h.file("doc.bin", "?");
    h.service.add_files(&[pic.clone(), doc.clone()]).unwrap();
    h.service
        .command(ShelfCommand::AddText { text: "t".into() })
        .unwrap();
    let ids: Vec<String> = h
        .service
        .snapshot()
        .unwrap()
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect();
    h.platform
        .set_thumbnail(pic.clone(), vec![0x89, b'P', b'N', b'G']);

    let url = h.service.thumbnail(&ids[0]).unwrap().unwrap();
    assert_eq!(url, "data:image/png;base64,iVBORw==");
    assert_eq!(h.service.thumbnail(&ids[0]).unwrap().unwrap(), url);
    assert_eq!(
        h.platform
            .file_ops_calls()
            .into_iter()
            .filter(|call| matches!(call, FileOpsCall::Thumbnail(..)))
            .count(),
        1,
        "the second call is served from the cache"
    );
    assert_eq!(
        h.platform.file_ops_calls()[0],
        FileOpsCall::Thumbnail(pic, THUMBNAIL_SIZE)
    );

    assert_eq!(
        h.service.thumbnail(&ids[1]).unwrap(),
        None,
        "no picture: placeholder"
    );
    assert_eq!(
        h.service.thumbnail(&ids[2]).unwrap(),
        None,
        "snippets have none"
    );
    assert!(matches!(
        h.service.thumbnail("nope"),
        Err(ShelfError::UnknownItem)
    ));

    // Removing the item drops its cached thumbnail.
    h.service
        .command(ShelfCommand::Remove {
            ids: vec![ids[0].clone()],
        })
        .unwrap();
    assert!(format!("{:?}", h.service).contains("thumbnails: 0"));
}

// --- storage copies ------------------------------------------------------------------------

#[test]
fn copy_into_storage_transfers_into_its_own_folder_and_cleans_up_on_remove() {
    let h = harness();
    h.set_settings(&ShelfSettings {
        copy_into_storage: true,
        expiry_days: 0,
    });
    let source = h.file("big.iso", "iso");

    assert_eq!(
        h.service.add_files(std::slice::from_ref(&source)).unwrap(),
        1
    );
    let calls = h.platform.file_ops_calls();
    let [
        FileOpsCall::Transfer {
            items,
            destination,
            mode,
        },
    ] = calls.as_slice()
    else {
        panic!("one transfer, got {calls:?}");
    };
    assert_eq!(items, &[source]);
    assert_eq!(*mode, TransferMode::Copy);
    assert_eq!(destination.parent(), Some(h.storage().as_path()));
    assert!(
        destination.is_dir(),
        "the folder exists before the shell copies into it"
    );

    let snapshot = h.service.snapshot().unwrap();
    assert_eq!(names(&snapshot), ["big.iso"]);
    assert!(snapshot.items[0].copied);
    assert!(
        snapshot.items[0].missing,
        "the fake shell copied nothing, so the copy is missing"
    );

    h.service
        .command(ShelfCommand::Remove {
            ids: vec![snapshot.items[0].id.clone()],
        })
        .unwrap();
    assert!(
        !destination.exists(),
        "the copy's folder went with the item"
    );
    assert!(h.storage().is_dir(), "storage itself stays");
}

#[test]
fn a_shell_refusal_while_copying_is_reported_and_stores_nothing() {
    let h = harness();
    h.set_settings(&ShelfSettings {
        copy_into_storage: true,
        expiry_days: 0,
    });
    h.platform
        .set_file_ops_error(Some(PlatformError::Cancelled("copy")));
    let source = h.file("a.txt", "a");
    assert!(matches!(
        h.service.add_files(&[source]),
        Err(ShelfError::Platform(PlatformError::Cancelled(_)))
    ));
    assert!(h.service.snapshot().unwrap().items.is_empty());
}

#[test]
fn without_a_profile_copies_are_refused_but_references_work() {
    let platform = Arc::new(FakePlatform::new());
    let service = ShelfService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        Arc::new(Store::open_in_memory().unwrap()),
        Arc::new(FakeClock::new()) as Arc<dyn Clock>,
        None,
    );
    let mut document = Settings::default();
    ShelfSettings {
        copy_into_storage: true,
        expiry_days: 0,
    }
    .write(&mut document)
    .unwrap();
    service.apply_settings(&document);
    assert!(matches!(
        service.add_files(&[PathBuf::from("C:\\a.txt")]),
        Err(ShelfError::NoStorage)
    ));
    service.apply_settings(&Settings::default());
    assert_eq!(service.add_files(&[PathBuf::from("C:\\a.txt")]).unwrap(), 1);
    assert!(platform.file_ops_calls().is_empty());
}

// --- expiry --------------------------------------------------------------------------------

#[test]
fn the_sweep_removes_items_older_than_the_expiry() {
    let h = harness();
    let old = h.file("old.txt", "o");
    h.service.add_files(&[old]).unwrap();
    h.clock.advance(Duration::from_hours(3 * 24));
    let fresh = h.file("fresh.txt", "f");
    h.service.add_files(&[fresh]).unwrap();

    assert!(!h.service.sweep().unwrap(), "never expires by default");
    h.set_settings(&ShelfSettings {
        copy_into_storage: false,
        expiry_days: 2,
    });
    let before = h.snapshots();
    assert!(h.service.sweep().unwrap());
    assert_eq!(names(&h.service.snapshot().unwrap()), ["fresh.txt"]);
    assert_eq!(h.snapshots(), before + 1);
    assert!(!h.service.sweep().unwrap(), "nothing left to expire");
    assert_eq!(h.snapshots(), before + 1);
}

// --- intake trait --------------------------------------------------------------------------

#[test]
fn the_intake_trait_counts_new_items_and_maps_errors() {
    let h = harness();
    let intake: Arc<dyn ShelfIntake> = Arc::clone(&h.service) as Arc<dyn ShelfIntake>;
    let a = h.file("a.txt", "a");
    assert_eq!(intake.add_files(&[a.clone(), a.clone()]).unwrap(), 1);
    assert_eq!(intake.add_files(&[a]).unwrap(), 0);

    h.set_settings(&ShelfSettings {
        copy_into_storage: true,
        expiry_days: 0,
    });
    h.platform.set_file_ops_error(Some(PlatformError::Os {
        api: "copy",
        code: 5,
    }));
    let error = intake
        .add_files(&[h.profile.path().join("b.txt")])
        .unwrap_err();
    assert!(error.to_string().contains("could not store"));
}

#[test]
fn a_shelf_turned_off_in_the_shell_refuses_the_drop_tile() {
    let h = harness();
    let intake: Arc<dyn ShelfIntake> = Arc::clone(&h.service) as Arc<dyn ShelfIntake>;
    let a = h.file("a.txt", "a");

    let mut document = Settings::default();
    document.shell.disabled_modules = vec![ID.to_owned()];
    h.service.apply_settings(&document);
    assert!(matches!(
        intake.add_files(std::slice::from_ref(&a)),
        Err(ShelfIntakeError::Disabled)
    ));
    assert!(h.service.snapshot().unwrap().items.is_empty());

    // Turning the module back on needs no restart, and the panel is told nothing meanwhile
    // (its own settings did not change).
    let before = h.snapshots();
    h.service.apply_settings(&Settings::default());
    assert_eq!(intake.add_files(&[a]).unwrap(), 1);
    assert_eq!(h.snapshots(), before + 1);
}
