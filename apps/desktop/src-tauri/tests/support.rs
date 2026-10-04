//! The `support` module (docs/modules/support.md, M5-E1a): the settings namespace and the
//! update channel, the diagnostics bundle (what goes in, what stays out, where it lands, how a
//! second one in the same minute is named), the links built in Rust, the bundled changelog and
//! the sink — all against a temporary profile, `FakePlatform` and `FakeClock`. Integration
//! tests because the `muna` lib cannot host unit tests (Common Controls manifest on
//! Tauri-linked tests).

use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{Clock, FakeClock, Hub, Settings, Store};
use muna_lib::modules::support::{
    BundleRecord, ID, REPO_URL, SupportError, SupportLink, SupportService, SupportSettings,
    SupportSink, SupportSnapshot, UpdateChannel, bundle_name,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, Platform, PlatformError, SystemDescription};
use parking_lot::Mutex;

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<SupportSnapshot>>,
}

impl SupportSink for RecordingSink {
    fn changed(&self, snapshot: &SupportSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

struct Harness {
    platform: Arc<FakePlatform>,
    clock: Arc<FakeClock>,
    service: Arc<SupportService>,
    sink: Arc<RecordingSink>,
    /// A throwaway profile (`settings.json`, `logs/`) and a throwaway Desktop.
    profile: tempfile::TempDir,
    desktop: tempfile::TempDir,
}

impl Harness {
    fn snapshots(&self) -> Vec<SupportSnapshot> {
        self.sink.snapshots.lock().clone()
    }

    /// Writes `body` as a file under the profile.
    fn profile_file(&self, relative: &str, body: &str) -> PathBuf {
        let path = self.profile.path().join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(&path, body).unwrap();
        path
    }
}

/// 2026-09-26 10:30:00 UTC; the bundle name is in local time, so tests only check its shape.
fn wall_origin() -> SystemTime {
    UNIX_EPOCH + Duration::from_mins(29_840_310)
}

fn harness() -> Harness {
    let platform = Arc::new(FakePlatform::new());
    let clock = Arc::new(FakeClock::at(wall_origin()));
    let profile = tempfile::tempdir().unwrap();
    let desktop = tempfile::tempdir().unwrap();
    platform.set_desktop_dir(Some(desktop.path().to_path_buf()));
    let service = Arc::new(SupportService::new(
        Arc::clone(&platform) as Arc<dyn Platform>,
        Arc::clone(&clock) as Arc<dyn Clock>,
        Some(profile.path().to_path_buf()),
    ));
    service.set_version("1.2.3");
    service.set_started_modules(&["hud", "media"]);
    let sink = Arc::new(RecordingSink::default());
    service.set_sink(Arc::clone(&sink) as Arc<dyn SupportSink>);
    Harness {
        platform,
        clock,
        service,
        sink,
        profile,
        desktop,
    }
}

fn settings_with(support: SupportSettings) -> Settings {
    let mut document = Settings::default();
    support.write(&mut document).unwrap();
    document
}

/// Every entry of the zip at `path` with its bytes.
fn entries(path: &Path) -> Vec<(String, Vec<u8>)> {
    let mut archive = zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap();
    (0..archive.len())
        .map(|index| {
            let mut file = archive.by_index(index).unwrap();
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).unwrap();
            (file.name().to_owned(), bytes)
        })
        .collect()
}

fn names(entries: &[(String, Vec<u8>)]) -> BTreeSet<&str> {
    entries.iter().map(|(name, _)| name.as_str()).collect()
}

fn text<'a>(entries: &'a [(String, Vec<u8>)], name: &str) -> &'a str {
    let (_, bytes) = entries
        .iter()
        .find(|(entry, _)| entry == name)
        .unwrap_or_else(|| panic!("{name} is in the bundle"));
    std::str::from_utf8(bytes).unwrap()
}

#[test]
fn settings_default_round_trip_and_survive_garbage() {
    let defaults = SupportSettings::default();
    assert_eq!(defaults.channel, UpdateChannel::Stable);
    assert!(
        !defaults.crash_reports,
        "no reporter ships; the opt-in stays off"
    );
    assert_eq!(
        SupportSettings::from_document(&Settings::default()),
        defaults
    );

    let beta = SupportSettings {
        channel: UpdateChannel::Beta,
        crash_reports: false,
    };
    let document = settings_with(beta);
    assert_eq!(
        document.modules[ID],
        serde_json::json!({ "channel": "beta", "crashReports": false })
    );
    assert_eq!(SupportSettings::from_document(&document), beta);

    let mut partial = Settings::default();
    partial
        .modules
        .insert(ID.into(), serde_json::json!({ "channel": "beta" }));
    assert_eq!(
        SupportSettings::from_document(&partial),
        beta,
        "missing keys keep their defaults"
    );

    let mut garbage = Settings::default();
    garbage
        .modules
        .insert(ID.into(), serde_json::json!("garbage"));
    assert_eq!(SupportSettings::from_document(&garbage), defaults);

    assert_ne!(
        UpdateChannel::Stable.endpoint(),
        UpdateChannel::Beta.endpoint()
    );
    assert!(
        UpdateChannel::Stable
            .endpoint()
            .ends_with("/releases/latest/download/latest.json")
    );
    assert!(
        UpdateChannel::Beta
            .endpoint()
            .contains("/releases/download/beta/")
    );
}

#[test]
fn the_module_is_registered_with_a_panel_and_answers_without_a_profile() {
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
        .expect("support is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel]);
    assert_eq!(services.support.settings(), SupportSettings::default());

    let snapshot = services.support.snapshot();
    assert_eq!(snapshot.version, "0.0.0", "no build described yet");
    assert_eq!(snapshot.channel, UpdateChannel::Stable);
    assert_eq!(snapshot.system.os, "Fake OS 1.0");
    assert_eq!(snapshot.system.webview2.as_deref(), Some("0.0.0.0"));
    assert_eq!(snapshot.profile_dir, None);
    assert_eq!(snapshot.logs_bytes, 0);
    assert_eq!(snapshot.last_bundle, None);
    assert!(!snapshot.changelog);
    assert!(
        services.support.diagnostics().is_err(),
        "the fake has no Desktop until a test scripts one"
    );
}

#[test]
fn diagnostics_zips_logs_settings_and_the_system_report_to_the_desktop() {
    let rig = harness();
    let settings_json = r#"{"version":3,"modules":{"support":{"channel":"stable"}}}"#;
    rig.profile_file("settings.json", settings_json);
    rig.profile_file("logs/muna.log", "2026-09-27 10:29:59 INFO starting\n");
    rig.profile_file("logs/muna.1.log", "older\n");
    rig.profile_file("logs/notes.txt", "not a log");
    rig.profile_file("shelf/keep.bin", "user content never travels");

    let record = rig.service.diagnostics().expect("bundle written");
    let path = Path::new(&record.path);
    assert_eq!(path.parent(), Some(rig.desktop.path()));
    let name = path.file_name().unwrap().to_str().unwrap();
    assert_eq!(name, bundle_name(rig.clock.system_time()));
    assert_eq!(record.entries, 5);
    assert_eq!(record.at_ms, 1_790_418_600_000);

    let entries = entries(path);
    assert_eq!(
        names(&entries),
        BTreeSet::from([
            "README.txt",
            "system.txt",
            "settings.json",
            "logs/muna.1.log",
            "logs/muna.log",
        ])
    );
    assert_eq!(text(&entries, "settings.json"), settings_json);
    assert_eq!(
        text(&entries, "logs/muna.log"),
        "2026-09-27 10:29:59 INFO starting\n"
    );

    let system = text(&entries, "system.txt");
    assert!(system.contains("Muna 1.2.3 (stable channel)\n"), "{system}");
    assert!(system.contains("OS: Fake OS 1.0\n"), "{system}");
    assert!(system.contains("WebView2: 0.0.0.0\n"), "{system}");
    assert!(system.contains("Monitors: 1\n"), "{system}");
    assert!(
        system.contains(r"  \\.\DISPLAY1 2560x1440 at (0, 0) dpi 96 primary"),
        "{system}"
    );
    assert!(system.contains("Modules: hud, media\n"), "{system}");
    let generated = system
        .lines()
        .find_map(|line| line.strip_prefix("Generated: "))
        .expect("a Generated line");
    assert_eq!(
        chrono::DateTime::parse_from_rfc3339(generated).unwrap(),
        chrono::DateTime::<chrono::Utc>::from(wall_origin()),
        "local time with an offset, the same instant"
    );

    let readme = text(&entries, "README.txt");
    assert!(readme.contains("Credential Manager"), "{readme}");
    assert!(readme.contains("github.com/miklol/Muna/issues"), "{readme}");

    let snapshots = rig.snapshots();
    assert_eq!(snapshots.len(), 1, "one change: the bundle");
    assert_eq!(snapshots[0].last_bundle.as_ref(), Some(&record));
    assert_eq!(
        snapshots[0].logs_bytes,
        u64::try_from("2026-09-27 10:29:59 INFO starting\n".len() + "older\n".len()).unwrap()
    );
    assert_eq!(
        snapshots[0].profile_dir.as_deref(),
        Some(rig.profile.path().to_str().unwrap())
    );
}

#[test]
fn a_bundle_without_logs_or_settings_still_carries_the_report() {
    let rig = harness();
    let record = rig.service.diagnostics().expect("bundle written");
    assert_eq!(record.entries, 2);
    let entries = entries(Path::new(&record.path));
    assert_eq!(
        names(&entries),
        BTreeSet::from(["README.txt", "system.txt"])
    );
}

#[test]
fn a_second_bundle_in_the_same_minute_gets_a_numbered_name() {
    let rig = harness();
    let first = rig.service.diagnostics().unwrap();
    let second = rig.service.diagnostics().unwrap();
    let third = rig.service.diagnostics().unwrap();
    assert_ne!(first.path, second.path);
    assert!(second.path.ends_with(" (2).zip"), "{}", second.path);
    assert!(third.path.ends_with(" (3).zip"), "{}", third.path);
    assert!(Path::new(&first.path).is_file() && Path::new(&third.path).is_file());

    rig.clock.advance(Duration::from_secs(60));
    let later = rig.service.diagnostics().unwrap();
    assert!(!later.path.ends_with(").zip"), "{}", later.path);
    assert_eq!(
        rig.snapshots().last().and_then(|s| s.last_bundle.clone()),
        Some(later)
    );
}

#[test]
fn diagnostics_without_a_desktop_folder_fail_and_change_nothing() {
    let rig = harness();
    rig.platform.set_desktop_dir(None);
    let error = rig.service.diagnostics().expect_err("no Desktop");
    assert!(
        matches!(error, SupportError::Platform(PlatformError::NotFound(_))),
        "{error:?}"
    );
    assert!(rig.snapshots().is_empty());
    assert_eq!(rig.service.snapshot().last_bundle, None);
}

#[test]
fn an_unanswerable_platform_reports_unknown_instead_of_failing_the_pane() {
    let rig = harness();
    rig.platform.set_system_description(SystemDescription {
        os: String::new(),
        webview2: None,
    });
    let snapshot = rig.service.snapshot();
    assert_eq!(snapshot.system.os, "");
    assert_eq!(snapshot.system.webview2, None);
    let record = rig.service.diagnostics().unwrap();
    let entries = entries(Path::new(&record.path));
    assert!(text(&entries, "system.txt").contains("WebView2: not installed\n"));
}

#[test]
fn links_are_built_in_rust_and_feedback_carries_the_system_facts() {
    let rig = harness();
    assert_eq!(
        rig.service.link(SupportLink::Help),
        format!("{REPO_URL}/tree/main/docs#readme")
    );
    assert_eq!(rig.service.link(SupportLink::Rate), REPO_URL);
    assert_eq!(
        rig.service.link(SupportLink::ReleaseNotes),
        format!("{REPO_URL}/releases/tag/v1.2.3")
    );

    let feedback = rig.service.link(SupportLink::Feedback);
    let url = tauri::Url::parse(&feedback).unwrap();
    assert_eq!(url.host_str(), Some("github.com"));
    assert_eq!(url.path(), "/miklol/Muna/issues/new");
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect();
    assert_eq!(pairs[0], ("labels".to_owned(), "bug".to_owned()));
    let body = &pairs[1].1;
    assert!(body.contains("- Muna 1.2.3\n"), "{body}");
    assert!(body.contains("- Fake OS 1.0\n"), "{body}");
    assert!(body.contains("- WebView2 0.0.0.0\n"), "{body}");
    assert!(body.starts_with("## What happened"), "{body}");
}

#[test]
fn the_changelog_is_the_first_candidate_that_exists() {
    let rig = harness();
    assert_eq!(rig.service.changelog(), None);
    assert!(!rig.service.snapshot().changelog);

    let shipped = rig.profile_file("resources/CHANGELOG.md", "# Changelog\n\n## 1.2.3\n");
    rig.service.set_changelog_candidates(vec![
        rig.profile.path().join("missing").join("CHANGELOG.md"),
        shipped,
    ]);
    assert_eq!(
        rig.service.changelog().as_deref(),
        Some("# Changelog\n\n## 1.2.3\n")
    );
    assert!(rig.service.snapshot().changelog);
}

#[test]
fn apply_settings_emits_once_per_change() {
    let rig = harness();
    let beta = settings_with(SupportSettings {
        channel: UpdateChannel::Beta,
        crash_reports: false,
    });
    rig.service.apply_settings(&beta);
    rig.service.apply_settings(&beta);
    let snapshots = rig.snapshots();
    assert_eq!(snapshots.len(), 1);
    assert_eq!(snapshots[0].channel, UpdateChannel::Beta);
    assert_eq!(rig.service.settings().channel, UpdateChannel::Beta);

    rig.service.apply_settings(&Settings::default());
    assert_eq!(rig.snapshots().len(), 2);
    assert_eq!(rig.service.settings().channel, UpdateChannel::Stable);

    let record = rig.service.diagnostics().unwrap();
    let entries = entries(Path::new(&record.path));
    assert!(text(&entries, "system.txt").contains("(stable channel)"));
}

#[test]
fn bundle_names_sort_by_minute() {
    let name = bundle_name(wall_origin());
    let digits = name
        .strip_prefix("muna-diagnostics-")
        .and_then(|rest| rest.strip_suffix(".zip"))
        .expect("prefix and suffix");
    let (day, minute) = digits.split_once('-').expect("date-time");
    assert_eq!(day.len(), 8);
    assert_eq!(minute.len(), 4);
    assert!(digits.chars().all(|c| c.is_ascii_digit() || c == '-'));
    assert!(bundle_name(wall_origin() + Duration::from_secs(60)) > name);

    let record = BundleRecord {
        path: "x".into(),
        entries: 2,
        at_ms: 0,
    };
    assert_eq!(
        serde_json::to_value(record).unwrap(),
        serde_json::json!({ "path": "x", "entries": 2, "atMs": 0 })
    );
}
