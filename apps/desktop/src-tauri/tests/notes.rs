//! The `notes` module (docs/modules/notes.md, M4-E7): the settings namespace, the folder
//! (default created on demand, a chosen one never), listing with pins on top, create / open /
//! save with the conflict check, rename with a pin following, delete to the Recycle Bin,
//! search, *Inbox* for quick capture and the sink — all against a temporary folder,
//! `FakePlatform` and an in-memory store. Integration tests because the `muna` lib cannot
//! host unit tests (Common Controls manifest on Tauri-linked tests).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use muna_core::{Clock, FakeClock, Hub, Settings, Store};
use muna_lib::modules::notes::{
    FolderProblem, ID, INBOX_ID, MAX_NOTE_BYTES, NoteDraft, NotesCommand, NotesError, NotesService,
    NotesSettings, NotesSink, NotesSnapshot, PINS_KEY,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, FileOpsCall, Platform, PlatformError};
use parking_lot::Mutex;

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<NotesSnapshot>>,
}

impl NotesSink for RecordingSink {
    fn changed(&self, snapshot: &NotesSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

struct Harness {
    platform: Arc<FakePlatform>,
    store: Arc<Store>,
    service: Arc<NotesService>,
    sink: Arc<RecordingSink>,
    /// A throwaway profile; `notes/` inside it is the default folder, `vault/` a chosen one.
    profile: tempfile::TempDir,
}

impl Harness {
    fn default_folder(&self) -> PathBuf {
        self.profile.path().join("notes")
    }

    fn vault(&self) -> PathBuf {
        self.profile.path().join("vault")
    }

    /// Points the module at `vault/` (created) through the settings document.
    fn use_vault(&self) -> PathBuf {
        let vault = self.vault();
        fs::create_dir_all(&vault).unwrap();
        self.set_folder(Some(vault.to_string_lossy().into_owned()));
        vault
    }

    fn set_folder(&self, folder: Option<String>) {
        let mut document = Settings::default();
        NotesSettings { folder }.write(&mut document).unwrap();
        self.service.apply_settings(&document);
    }

    fn snapshots(&self) -> usize {
        self.sink.snapshots.lock().len()
    }

    fn calls(&self) -> Vec<FileOpsCall> {
        self.platform.file_ops_calls()
    }

    fn pins(&self) -> Vec<String> {
        self.store
            .get_meta(PINS_KEY)
            .unwrap()
            .map(|json| serde_json::from_str(&json).unwrap())
            .unwrap_or_default()
    }
}

/// Writes a note straight to disk (another app) with a modified time `age` before now, so
/// the order the list shows is deterministic.
fn note(dir: &Path, name: &str, body: &str, age: Duration) -> PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, body).unwrap();
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(SystemTime::now() - age).unwrap();
    path
}

fn harness() -> Harness {
    let platform = Arc::new(FakePlatform::new());
    let store = Arc::new(Store::open_in_memory().unwrap());
    let profile = tempfile::tempdir().unwrap();
    let service = Arc::new(NotesService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        Arc::clone(&store),
        Some(profile.path().join("notes")),
    ));
    let sink = Arc::new(RecordingSink::default());
    service.set_sink(Arc::clone(&sink) as Arc<dyn NotesSink>);
    Harness {
        platform,
        store,
        service,
        sink,
        profile,
    }
}

fn ids(snapshot: &NotesSnapshot) -> Vec<&str> {
    snapshot.notes.iter().map(|note| note.id.as_str()).collect()
}

/// What the editor sends back after loading a note with `base` as its modified time.
fn draft(id: &str, body: &str, base: i64) -> NoteDraft {
    NoteDraft {
        id: id.to_owned(),
        body: body.to_owned(),
        base_modified_ms: base,
    }
}

const MINUTE: Duration = Duration::from_secs(60);

// --- registry & settings -------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_a_panel_and_a_widget() {
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
        .expect("notes is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel, Surface::Widget]);
    assert_eq!(services.notes.settings(), NotesSettings::default());

    // A build without a profile has no folder: the snapshot says so and writes refuse.
    let snapshot = services.notes.refresh();
    assert_eq!(snapshot.problem, Some(FolderProblem::Missing));
    assert!(snapshot.notes.is_empty());
    assert!(matches!(
        services.notes.create("Anything"),
        Err(NotesError::NoFolder)
    ));
}

#[test]
fn settings_round_trip_and_a_blank_folder_means_the_default() {
    let mut document = Settings::default();
    NotesSettings {
        folder: Some("  D:\\Vault  ".into()),
    }
    .write(&mut document)
    .unwrap();
    assert_eq!(
        NotesSettings::from_document(&document),
        NotesSettings {
            folder: Some("D:\\Vault".into()),
        }
    );

    NotesSettings {
        folder: Some("   ".into()),
    }
    .write(&mut document)
    .unwrap();
    assert_eq!(
        NotesSettings::from_document(&document),
        NotesSettings::default()
    );

    // A malformed namespace falls back to the defaults instead of failing the document.
    document
        .modules
        .insert(ID.into(), serde_json::json!({ "folder": 42 }));
    assert_eq!(
        NotesSettings::from_document(&document),
        NotesSettings::default()
    );
}

#[test]
fn a_folder_change_switches_the_listing_and_notifies() {
    let h = harness();
    note(&h.default_folder(), "Home.md", "at home", MINUTE);
    assert_eq!(ids(&h.service.refresh()), ["Home.md"]);
    assert_eq!(h.snapshots(), 0, "a plain refresh is silent");

    let vault = h.use_vault();
    note(&vault, "Vault.md", "in the vault", MINUTE);
    assert_eq!(h.snapshots(), 1, "a folder change tells the sink");
    let snapshot = h.service.refresh();
    assert_eq!(ids(&snapshot), ["Vault.md"]);
    assert!(!snapshot.default_folder);
    assert_eq!(snapshot.folder, vault.to_string_lossy());

    // Applying the same settings again changes nothing.
    h.set_folder(Some(vault.to_string_lossy().into_owned()));
    assert_eq!(h.snapshots(), 1);

    h.set_folder(None);
    assert_eq!(h.snapshots(), 2);
    let snapshot = h.service.refresh();
    assert_eq!(ids(&snapshot), ["Home.md"]);
    assert!(snapshot.default_folder);
}

// --- the folder -----------------------------------------------------------------------------

#[test]
fn the_default_folder_is_created_on_demand() {
    let h = harness();
    assert!(!h.default_folder().exists());
    let snapshot = h.service.refresh();
    assert!(h.default_folder().is_dir());
    assert!(snapshot.default_folder);
    assert_eq!(snapshot.problem, None);
    assert!(snapshot.notes.is_empty());
    assert_eq!(snapshot.inbox_id, None);
}

#[test]
fn a_chosen_folder_that_is_missing_is_reported_and_never_recreated() {
    let h = harness();
    let vault = h.vault();
    h.set_folder(Some(vault.to_string_lossy().into_owned()));
    let snapshot = h.service.refresh();
    assert_eq!(snapshot.problem, Some(FolderProblem::Missing));
    assert!(!snapshot.default_folder);
    assert!(!vault.exists(), "an unmounted vault is not recreated");
    assert!(matches!(h.service.create("New"), Err(NotesError::Io(_))));
    assert!(matches!(h.service.open_inbox(), Err(NotesError::Io(_))));
    assert!(matches!(h.service.reveal_folder(), Err(NotesError::Io(_))));
}

#[test]
fn the_listing_walks_sub_folders_and_skips_dot_folders_and_other_files() {
    let h = harness();
    let dir = h.default_folder();
    note(&dir, "Root.md", "root", 3 * MINUTE);
    note(
        &dir,
        "projects/Muna.md",
        "# Muna\n\nA notch for Windows.",
        2 * MINUTE,
    );
    note(&dir, ".obsidian/workspace.md", "hidden", MINUTE);
    note(&dir, "notes.txt", "not markdown", MINUTE);
    note(&dir, "image.png", "binary", MINUTE);

    let snapshot = h.service.refresh();
    assert_eq!(ids(&snapshot), ["projects/Muna.md", "Root.md"]);
    let muna = &snapshot.notes[0];
    assert_eq!(muna.title, "Muna");
    assert_eq!(muna.folder, "projects");
    assert_eq!(muna.excerpt, "Muna A notch for Windows.");
    assert!(!muna.pinned);
    assert_eq!(snapshot.notes[1].folder, "");
}

// --- create, open, save ---------------------------------------------------------------------

#[test]
fn create_open_and_save_round_trip_through_plain_markdown_files() {
    let h = harness();
    let created = h.service.create("Meeting: notes / ideas?").unwrap();
    assert_eq!(created.id, "Meeting notes ideas.md");
    assert_eq!(created.title, "Meeting notes ideas");
    assert_eq!(created.body, "");
    assert_eq!(h.snapshots(), 1, "a new file tells the sink");

    let path = h.default_folder().join("Meeting notes ideas.md");
    assert!(path.is_file());

    let saved = h
        .service
        .save(&draft(
            &created.id,
            "- buy milk\n- call **Ann**\n",
            created.modified_ms,
        ))
        .unwrap();
    assert_eq!(saved.id, created.id);
    assert_eq!(saved.body, "- buy milk\n- call **Ann**\n");
    assert_eq!(h.snapshots(), 2);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "- buy milk\n- call **Ann**\n",
        "the file is what any other app reads"
    );

    let opened = h.service.open(&created.id).unwrap();
    assert_eq!(opened.body, saved.body);
    assert_eq!(opened.modified_ms, saved.modified_ms);

    let snapshot = h.service.refresh();
    assert_eq!(snapshot.notes[0].excerpt, "buy milk call Ann");
    assert_eq!(snapshot.notes[0].bytes, 26);

    // The same title again gets a numbered file rather than clobbering the first.
    let second = h.service.create("Meeting: notes / ideas?").unwrap();
    assert_eq!(second.id, "Meeting notes ideas 2.md");
    assert_eq!(second.title, "Meeting notes ideas 2");

    assert!(matches!(
        h.service.create("   "),
        Err(NotesError::EmptyTitle)
    ));
}

#[test]
fn a_save_over_a_file_changed_elsewhere_is_refused_until_it_is_reopened() {
    let h = harness();
    let created = h.service.create("Shared").unwrap();
    let path = h.default_folder().join("Shared.md");

    // Another app writes the file (a clearly different modified time).
    fs::write(&path, "edited in Obsidian\n").unwrap();
    let file = fs::File::options().write(true).open(&path).unwrap();
    file.set_modified(SystemTime::now() + Duration::from_secs(5))
        .unwrap();

    assert!(matches!(
        h.service
            .save(&draft(&created.id, "mine", created.modified_ms)),
        Err(NotesError::Conflict)
    ));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "edited in Obsidian\n",
        "the other app's edit is kept"
    );

    let reopened = h.service.open(&created.id).unwrap();
    assert_eq!(reopened.body, "edited in Obsidian\n");
    let saved = h
        .service
        .save(&draft(
            &created.id,
            "edited in Obsidian\nand in Muna\n",
            reopened.modified_ms,
        ))
        .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), saved.body);
}

#[test]
fn ids_outside_the_folder_or_not_markdown_are_unknown() {
    let h = harness();
    let _ = h.service.refresh();
    for id in [
        "../outside.md",
        "..\\outside.md",
        "C:\\Windows\\notes.md",
        "sub\\note.md",
        "note.txt",
        "missing.md",
        "",
    ] {
        assert!(
            matches!(h.service.open(id), Err(NotesError::Unknown)),
            "{id:?} opens"
        );
        assert!(
            matches!(h.service.save(&draft(id, "x", 0)), Err(NotesError::Unknown)),
            "{id:?} saves"
        );
        assert!(
            matches!(h.service.rename(id, "New"), Err(NotesError::Unknown)),
            "{id:?} renames"
        );
        assert!(
            matches!(h.service.reveal(id), Err(NotesError::Unknown)),
            "{id:?} reveals"
        );
        assert!(
            matches!(
                h.service.command(NotesCommand::Delete { id: id.into() }),
                Err(NotesError::Unknown)
            ),
            "{id:?} deletes"
        );
    }
    assert!(h.calls().is_empty(), "nothing reached the OS");
}

#[test]
fn windows_line_endings_are_normalised_for_the_editor() {
    let h = harness();
    note(&h.default_folder(), "Crlf.md", "one\r\ntwo\r\n", MINUTE);
    let opened = h.service.open("Crlf.md").unwrap();
    assert_eq!(opened.body, "one\ntwo\n");
}

#[test]
fn a_note_too_large_for_the_editor_is_listed_but_opens_externally() {
    let h = harness();
    let dir = h.default_folder();
    let big = dir.join("Big.md");
    fs::create_dir_all(&dir).unwrap();
    let body = vec![b'x'; usize::try_from(MAX_NOTE_BYTES).unwrap() + 1];
    fs::write(&big, body).unwrap();

    let snapshot = h.service.refresh();
    assert_eq!(ids(&snapshot), ["Big.md"]);
    assert_eq!(
        snapshot.notes[0].bytes,
        i64::try_from(MAX_NOTE_BYTES).unwrap() + 1
    );
    assert!(matches!(
        h.service.open("Big.md"),
        Err(NotesError::TooLarge)
    ));

    h.service.open_external("Big.md").unwrap();
    assert_eq!(h.calls(), [FileOpsCall::Open(big)]);
}

// --- inbox -----------------------------------------------------------------------------------

#[test]
fn the_inbox_is_created_once_for_quick_capture() {
    let h = harness();
    assert_eq!(h.service.refresh().inbox_id, None);

    let inbox = h.service.open_inbox().unwrap();
    assert_eq!(inbox.id, INBOX_ID);
    assert_eq!(inbox.title, "Inbox");
    assert_eq!(inbox.body, "");
    assert_eq!(h.snapshots(), 1, "the new file tells the sink");
    assert_eq!(h.service.refresh().inbox_id, Some(INBOX_ID.into()));

    let saved = h
        .service
        .save(&draft(INBOX_ID, "- remember the milk\n", inbox.modified_ms))
        .unwrap();
    let again = h.service.open_inbox().unwrap();
    assert_eq!(
        again.body, saved.body,
        "an existing inbox is opened, not replaced"
    );
    assert_eq!(again.modified_ms, saved.modified_ms);
    assert_eq!(h.snapshots(), 2);
}

// --- pins ------------------------------------------------------------------------------------

#[test]
fn pinned_notes_come_first_and_the_pins_live_in_the_store() {
    let h = harness();
    let dir = h.default_folder();
    note(&dir, "Old.md", "", 3 * MINUTE);
    note(&dir, "Mid.md", "", 2 * MINUTE);
    note(&dir, "New.md", "", MINUTE);
    assert_eq!(ids(&h.service.refresh()), ["New.md", "Mid.md", "Old.md"]);

    let snapshot = h
        .service
        .command(NotesCommand::Pin {
            id: "Old.md".into(),
            pinned: true,
        })
        .unwrap();
    assert_eq!(ids(&snapshot), ["Old.md", "New.md", "Mid.md"]);
    assert!(snapshot.notes[0].pinned);
    assert_eq!(h.pins(), ["Old.md"]);
    assert_eq!(h.snapshots(), 1);

    h.service
        .command(NotesCommand::Pin {
            id: "Mid.md".into(),
            pinned: true,
        })
        .unwrap();
    assert_eq!(
        ids(&h.service.refresh()),
        ["Mid.md", "Old.md", "New.md"],
        "pinned notes keep newest-first among themselves"
    );

    // Pinning twice is idempotent; unpinning removes it. The store keeps pin order, the
    // list sorts pinned notes by time.
    h.service
        .command(NotesCommand::Pin {
            id: "Mid.md".into(),
            pinned: true,
        })
        .unwrap();
    assert_eq!(h.pins(), ["Old.md", "Mid.md"]);
    let snapshot = h
        .service
        .command(NotesCommand::Pin {
            id: "Old.md".into(),
            pinned: false,
        })
        .unwrap();
    assert_eq!(ids(&snapshot), ["Mid.md", "New.md", "Old.md"]);
    assert_eq!(h.pins(), ["Mid.md"]);

    assert!(matches!(
        h.service.command(NotesCommand::Pin {
            id: "Gone.md".into(),
            pinned: true,
        }),
        Err(NotesError::Unknown)
    ));

    // A new service over the same store reads the pins back.
    let fresh = NotesService::new(
        Arc::clone(&h.platform) as Arc<dyn Platform>,
        Arc::clone(&h.store),
        Some(dir.clone()),
    );
    assert!(fresh.refresh().notes[0].pinned);
    assert_eq!(ids(&fresh.refresh()), ["Mid.md", "New.md", "Old.md"]);
}

#[test]
fn a_pin_for_a_note_that_vanished_is_dropped_unless_the_folder_is_away() {
    let h = harness();
    let vault = h.use_vault();
    note(&vault, "Keep.md", "", MINUTE);
    note(&vault, "Gone.md", "", MINUTE);
    for id in ["Keep.md", "Gone.md"] {
        h.service
            .command(NotesCommand::Pin {
                id: id.into(),
                pinned: true,
            })
            .unwrap();
    }
    assert_eq!(h.pins(), ["Keep.md", "Gone.md"]);

    // The whole vault unmounted: the pins wait for it.
    fs::remove_dir_all(&vault).unwrap();
    assert_eq!(h.service.refresh().problem, Some(FolderProblem::Missing));
    assert_eq!(h.pins(), ["Keep.md", "Gone.md"]);

    // The vault is back without one file: that pin goes.
    fs::create_dir_all(&vault).unwrap();
    note(&vault, "Keep.md", "", MINUTE);
    let snapshot = h.service.refresh();
    assert_eq!(ids(&snapshot), ["Keep.md"]);
    assert!(snapshot.notes[0].pinned);
    assert_eq!(h.pins(), ["Keep.md"]);
}

// --- rename ----------------------------------------------------------------------------------

#[test]
fn a_rename_moves_the_file_and_the_pin_follows() {
    let h = harness();
    let dir = h.default_folder();
    note(&dir, "projects/Draft.md", "words", MINUTE);
    note(&dir, "projects/Taken.md", "", MINUTE);
    h.service
        .command(NotesCommand::Pin {
            id: "projects/Draft.md".into(),
            pinned: true,
        })
        .unwrap();
    let before = h.snapshots();

    let renamed = h
        .service
        .rename("projects/Draft.md", " Final: version? ")
        .unwrap();
    assert_eq!(renamed.id, "projects/Final version.md");
    assert_eq!(renamed.title, "Final version");
    assert_eq!(renamed.folder, "projects");
    assert!(renamed.pinned, "the pin follows the file");
    assert_eq!(renamed.excerpt, "words");
    assert!(dir.join("projects/Final version.md").is_file());
    assert!(!dir.join("projects/Draft.md").exists());
    assert_eq!(h.pins(), ["projects/Final version.md"]);
    assert_eq!(h.snapshots(), before + 1);

    // A taken name gets a number; the same name is a no-op; a blank one is refused.
    let clash = h.service.rename(&renamed.id, "Taken").unwrap();
    assert_eq!(clash.id, "projects/Taken 2.md");
    let same = h.service.rename(&clash.id, "Taken 2").unwrap();
    assert_eq!(same.id, "projects/Taken 2.md");
    assert!(matches!(
        h.service.rename(&same.id, "  "),
        Err(NotesError::EmptyTitle)
    ));
    assert_eq!(h.pins(), ["projects/Taken 2.md"]);
}

// --- delete, reveal, open, folder picker -----------------------------------------------------

#[test]
fn delete_goes_to_the_recycle_bin_through_the_platform_and_drops_the_pin() {
    let h = harness();
    let dir = h.default_folder();
    let path = note(&dir, "Bye.md", "", MINUTE);
    h.service
        .command(NotesCommand::Pin {
            id: "Bye.md".into(),
            pinned: true,
        })
        .unwrap();

    h.service
        .command(NotesCommand::Delete {
            id: "Bye.md".into(),
        })
        .unwrap();
    assert_eq!(h.calls(), [FileOpsCall::Recycle(vec![path.clone()])]);
    assert!(h.pins().is_empty());
    assert!(
        path.is_file(),
        "the fake does not remove files; the OS call is what counts"
    );

    // A refusal from the OS surfaces as a platform error and changes nothing.
    h.platform
        .set_file_ops_error(Some(PlatformError::Unsupported("recycle")));
    assert!(matches!(
        h.service.command(NotesCommand::Delete {
            id: "Bye.md".into()
        }),
        Err(NotesError::Platform(_))
    ));
}

#[test]
fn reveal_and_open_hand_the_file_to_the_shell() {
    let h = harness();
    let dir = h.default_folder();
    let path = note(&dir, "Show.md", "", MINUTE);
    h.service.reveal("Show.md").unwrap();
    h.service.open_external("Show.md").unwrap();
    h.service.reveal_folder().unwrap();
    assert_eq!(
        h.calls(),
        [
            FileOpsCall::Reveal(vec![path.clone()]),
            FileOpsCall::Open(path),
            FileOpsCall::Open(dir),
        ]
    );
}

#[test]
fn the_folder_picker_is_the_platform_dialog() {
    let h = harness();
    assert_eq!(h.service.choose_folder("Notes folder").unwrap(), None);
    let chosen = h.vault();
    h.platform.set_picked_folder(Some(chosen.clone()));
    assert_eq!(
        h.service.choose_folder("Notes folder").unwrap(),
        Some(chosen)
    );
    assert_eq!(
        h.calls(),
        [
            FileOpsCall::PickFolder(0, "Notes folder".into()),
            FileOpsCall::PickFolder(0, "Notes folder".into()),
        ]
    );
}

// --- search ----------------------------------------------------------------------------------

#[test]
fn search_matches_titles_and_bodies_case_insensitively_newest_first() {
    let h = harness();
    let dir = h.default_folder();
    note(&dir, "Groceries.md", "- milk\n- eggs\n", 3 * MINUTE);
    note(&dir, "Milk run.md", "when the shop opens", 2 * MINUTE);
    note(&dir, "Unrelated.md", "nothing here", MINUTE);
    note(&dir, "sub/Deep.md", "MILK again", 4 * MINUTE);

    assert_eq!(
        h.service.search("milk"),
        ["Milk run.md", "Groceries.md", "sub/Deep.md"]
    );
    assert_eq!(h.service.search("  MILK "), h.service.search("milk"));
    assert!(h.service.search("").is_empty());
    assert!(h.service.search("   ").is_empty());
    assert!(h.service.search("zebra").is_empty());
}

// --- the sink --------------------------------------------------------------------------------

#[test]
fn writes_tell_the_sink_and_reads_do_not() {
    let h = harness();
    let _ = h.service.refresh();
    let _ = h.service.search("x");
    h.service.command(NotesCommand::Refresh).unwrap();
    assert_eq!(
        h.snapshots(),
        1,
        "only the explicit refresh command notifies"
    );

    let note = h.service.create("Log").unwrap();
    h.service.open(&note.id).unwrap();
    h.service
        .save(&draft(&note.id, "one", note.modified_ms))
        .unwrap();
    h.service.rename(&note.id, "Journal").unwrap();
    h.service.reveal("Journal.md").unwrap();
    assert_eq!(h.snapshots(), 4);
    let last = h.sink.snapshots.lock().last().cloned().unwrap();
    assert_eq!(ids(&last), ["Journal.md"]);
    assert_eq!(last.notes[0].excerpt, "one");
}
