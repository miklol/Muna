//! The `screen-time` module (docs/modules/screen-time.md, M4-E8): attribution from foreground
//! changes, idle and lock pauses, sleep gaps, the day boundary, the minute flush, exclusions,
//! categories and limits, the limit notice, clearing, the CSV export and publishing — all
//! against `FakePlatform`, a `FakeClock` pinned to a known day, a fixed zone and an in-memory
//! store. Integration tests because the `muna` lib cannot host unit tests (Common Controls
//! manifest on Tauri-linked tests).

use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use muna_core::{Clock, FakeClock, Hub, Settings, Store, StripContent, StripMessage, StripSink};
use muna_lib::modules::screen_time::{
    AppCategory, FixedZone, ID, ScreenTimeCommand, ScreenTimeError, ScreenTimeService,
    ScreenTimeSettings, ScreenTimeSink, ScreenTimeSnapshot, TICK, Tracking, WEEK_DAYS,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{AppDescription, FakePlatform, FileOpsCall, ForegroundWindow, Platform, Rect};
use parking_lot::Mutex;

const SECOND: Duration = Duration::from_secs(1);
const MINUTE: Duration = Duration::from_secs(60);
const HOUR: Duration = Duration::from_secs(3600);
const MS_PER_MINUTE: i64 = 60_000;

/// 2024-06-12 12:00:00 UTC: with `FixedZone(0)` the day started at 2024-06-12 00:00 UTC.
const NOON_MS: i64 = 1_718_193_600_000;
const DAY_MS: i64 = 86_400_000;
const MIDNIGHT_MS: i64 = NOON_MS - 12 * 3_600_000;

const CODE: &str = "C:\\Apps\\Code\\Code.exe";
const CHROME: &str = "C:\\Apps\\Chrome\\chrome.exe";
const STEAM: &str = "C:\\Apps\\Steam\\steam.exe";

/// A one-pixel PNG: enough for the data URL to be recognisable.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";

#[derive(Debug, Default)]
struct RecordingSink {
    snapshots: Mutex<Vec<ScreenTimeSnapshot>>,
}

impl ScreenTimeSink for RecordingSink {
    fn changed(&self, snapshot: &ScreenTimeSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

/// Counts strip publications, since the hub only exposes what shows right now.
#[derive(Debug, Default)]
struct StripRecorder {
    notices: Mutex<Vec<String>>,
}

impl StripSink for StripRecorder {
    fn strip_changed(&self, content: &StripContent) {
        if let StripContent::Notice { notice } = content {
            self.notices.lock().push(notice.id.clone());
        }
    }
}

struct Rig {
    platform: Arc<FakePlatform>,
    clock: Arc<FakeClock>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    service: Arc<ScreenTimeService>,
    sink: Arc<RecordingSink>,
    strip: Arc<StripRecorder>,
}

impl Rig {
    fn at(wall_ms: i64) -> Self {
        let platform = Arc::new(FakePlatform::new());
        platform.set_app_description(
            PathBuf::from(CODE),
            AppDescription {
                name: Some("Visual Studio Code".into()),
                icon_png: Some(PNG.to_vec()),
            },
        );
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_millis(u64::try_from(wall_ms).unwrap()),
        ));
        let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
        let strip = Arc::new(StripRecorder::default());
        hub.add_sink(Arc::clone(&strip) as Arc<dyn StripSink>);
        let store = Arc::new(Store::open_in_memory().unwrap());
        let service = Arc::new(ScreenTimeService::new(
            Arc::clone(&platform) as Arc<dyn Platform>,
            Arc::clone(&hub),
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::new(FixedZone(0)),
        ));
        let sink = Arc::new(RecordingSink::default());
        service.set_sink(Arc::clone(&sink) as Arc<dyn ScreenTimeSink>);
        service.apply_settings(&Settings::default());
        Self {
            platform,
            clock,
            hub,
            store,
            service,
            sink,
            strip,
        }
    }

    fn new() -> Self {
        Self::at(NOON_MS)
    }

    fn now_ms(&self) -> i64 {
        let elapsed = self.clock.system_time().duration_since(UNIX_EPOCH).unwrap();
        i64::try_from(elapsed.as_millis()).unwrap()
    }

    /// The platform reports `path` in the foreground; the backend forwards it to the service.
    fn foreground(&self, path: &str) {
        let window = ForegroundWindow {
            handle: 0x1234,
            title: "never read".into(),
            process_name: path.rsplit('\\').next().unwrap().to_owned(),
            process_path: path.to_owned(),
            bounds: Rect {
                x: 0,
                y: 0,
                width: 800,
                height: 600,
            },
            is_fullscreen: false,
        };
        self.platform.foreground_changed(window.clone());
        self.service.handle_foreground(&window);
    }

    /// Starts recording `path` right now: the first tick resumes from the platform's foreground.
    fn start_on(&self, path: &str) {
        self.foreground(path);
        self.service.tick();
    }

    fn advance(&self, by: Duration) {
        self.clock.advance(by);
    }

    /// Lets `by` pass as the backend loop would see it: a tick every [`TICK`] (and one at the
    /// end), so the sleep-gap detector stays quiet.
    fn run(&self, by: Duration) {
        let mut remaining = by;
        while !remaining.is_zero() {
            let step = remaining.min(TICK);
            self.clock.advance(step);
            self.service.tick();
            remaining -= step;
        }
    }

    fn snapshot(&self) -> ScreenTimeSnapshot {
        self.service.snapshot().unwrap()
    }

    fn total_of(&self, exe: &str) -> i64 {
        self.snapshot()
            .apps
            .iter()
            .find(|app| app.exe == exe)
            .map_or(0, |app| app.total_ms)
    }

    fn set_settings(&self, settings: &ScreenTimeSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).unwrap();
        self.service.apply_settings(&document);
    }

    fn stored_sessions(&self) -> Vec<(String, i64, i64)> {
        self.store
            .usage_sessions_between(i64::MIN, i64::MAX)
            .unwrap()
            .into_iter()
            .map(|session| (session.exe, session.started_at_ms, session.ended_at_ms))
            .collect()
    }

    fn shown_notice_id(&self) -> Option<String> {
        match self.hub.current() {
            StripContent::Notice { notice } => Some(notice.id),
            _ => None,
        }
    }
}

fn minutes(count: i64) -> i64 {
    count * MS_PER_MINUTE
}

// --- registry & settings -------------------------------------------------------------------

#[test]
fn the_module_is_registered_with_strip_panel_and_widget() {
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
        .expect("screen time is registered");
    assert_eq!(
        backend.capabilities(),
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    );
    assert_eq!(
        services.screen_time.settings(),
        ScreenTimeSettings::default()
    );
    assert!(services.screen_time.settings().enabled, "on by default");

    // Nothing seen yet: an empty day, tracking active, seven days in the week.
    let snapshot = services.screen_time.snapshot().unwrap();
    assert_eq!(snapshot.tracking, Tracking::Active);
    assert!(snapshot.now.is_none());
    assert!(snapshot.apps.is_empty());
    assert_eq!(snapshot.today.total_ms, 0);
    assert_eq!(snapshot.week.len(), WEEK_DAYS);
    assert_eq!(
        snapshot.week.last().unwrap().day_start_ms,
        snapshot.day_start_ms
    );
}

// --- attribution ---------------------------------------------------------------------------

#[test]
fn foreground_switches_record_spans_and_rank_apps_by_time() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);
    rig.foreground(CHROME);
    rig.advance(3 * MINUTE);
    rig.foreground(CODE);
    rig.advance(2 * MINUTE);

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Active);
    assert_eq!(snapshot.today.total_ms, minutes(10));
    assert_eq!(snapshot.today.switches, 3);
    assert_eq!(snapshot.today.longest_ms, minutes(5));
    assert_eq!(snapshot.day_start_ms, MIDNIGHT_MS);

    let names: Vec<(&str, i64)> = snapshot
        .apps
        .iter()
        .map(|app| (app.exe.as_str(), app.total_ms))
        .collect();
    assert_eq!(
        names,
        vec![("code.exe", minutes(7)), ("chrome.exe", minutes(3))],
        "most time first; the open span counts up to now"
    );
    let code = &snapshot.apps[0];
    assert_eq!(code.name, "Visual Studio Code", "from the version resource");
    assert_eq!(code.category, AppCategory::Development);
    assert_eq!(code.sessions, 2);
    assert!(
        code.icon
            .as_deref()
            .is_some_and(|icon| icon.starts_with("data:image/png;base64,")),
        "the icon travels as a data URL"
    );
    let chrome = &snapshot.apps[1];
    assert_eq!(chrome.name, "Chrome", "from the file name when undescribed");
    assert_eq!(chrome.category, AppCategory::Browsing);
    assert!(chrome.icon.is_none());

    let now = snapshot.now.expect("code is in the foreground");
    assert_eq!(now.exe, "code.exe");
    assert_eq!(now.since_ms, NOON_MS + minutes(8));

    let categories: Vec<(AppCategory, i64)> = snapshot
        .categories
        .iter()
        .map(|entry| (entry.category, entry.total_ms))
        .collect();
    assert_eq!(
        categories,
        vec![
            (AppCategory::Browsing, minutes(3)),
            (AppCategory::Development, minutes(7))
        ],
        "legend order, so the donut's segments never swap"
    );
    assert_eq!(snapshot.week.last().unwrap().total_ms, minutes(10));
    assert!(
        snapshot.week[..WEEK_DAYS - 1]
            .iter()
            .all(|day| day.total_ms == 0)
    );

    // The executable was described once, on first sighting, at the icon size.
    let calls = rig.platform.app_info_calls();
    assert_eq!(
        calls
            .iter()
            .filter(|(path, _)| path == &PathBuf::from(CODE))
            .count(),
        1
    );
    assert!(calls.iter().all(|(_, size)| *size == 64));
}

#[test]
fn own_windows_and_passing_switches_are_not_recorded() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);
    rig.foreground("C:\\Program Files\\Muna\\muna.exe");
    rig.advance(MINUTE);
    rig.foreground(CODE);
    rig.advance(Duration::from_millis(500));
    rig.foreground(CHROME);
    rig.advance(MINUTE);

    let snapshot = rig.snapshot();
    assert_eq!(
        rig.total_of("code.exe"),
        minutes(5),
        "the notch minute is nobody's"
    );
    assert_eq!(rig.total_of("chrome.exe"), minutes(1));
    assert_eq!(
        snapshot.today.switches, 2,
        "the half-second pass through Code is dropped"
    );
    assert!(
        rig.store
            .usage_apps()
            .unwrap()
            .iter()
            .all(|app| app.exe != "muna.exe"),
        "Muna never gets an app row"
    );
}

#[test]
fn idle_pauses_at_the_moment_input_stopped_and_resumes_when_it_returns() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.run(10 * MINUTE);
    rig.platform.set_idle_for(6 * MINUTE);
    rig.service.tick();

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Idle);
    assert!(snapshot.now.is_none());
    assert_eq!(
        rig.total_of("code.exe"),
        minutes(4),
        "the span ended when input stopped, not when the tick noticed"
    );

    rig.run(MINUTE);
    assert_eq!(
        rig.total_of("code.exe"),
        minutes(4),
        "nothing accrues while away"
    );
    rig.platform.set_idle_for(2 * SECOND);
    rig.service.tick();
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Active);
    let now = snapshot.now.expect("back on code");
    assert_eq!(now.since_ms, rig.now_ms() - 2_000, "resumed when input did");
    assert_eq!(rig.total_of("code.exe"), minutes(4) + 2_000);
}

#[test]
fn locking_closes_the_span_and_unlocking_reopens_the_foreground_app() {
    let rig = Rig::new();
    rig.start_on(CODE);
    assert_eq!(rig.service.cadence(), Some(TICK));
    rig.run(5 * MINUTE);

    rig.service.set_locked(true);
    assert_eq!(rig.snapshot().tracking, Tracking::Locked);
    assert_eq!(
        rig.service.cadence(),
        None,
        "nothing to tick for while locked"
    );
    rig.advance(30 * MINUTE);
    rig.service.tick();
    assert_eq!(rig.total_of("code.exe"), minutes(5));

    rig.service.set_locked(false);
    assert_eq!(rig.service.cadence(), Some(TICK));
    rig.run(MINUTE);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Active);
    assert_eq!(
        snapshot.now.unwrap().since_ms,
        NOON_MS + minutes(35),
        "the half hour without ticks is the lock, not a sleep"
    );
    assert_eq!(rig.total_of("code.exe"), minutes(6));
}

#[test]
fn a_sleep_gap_ends_the_span_at_the_last_tick() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.run(10 * SECOND);
    rig.clock.sleep(2 * HOUR);
    rig.service.tick();
    rig.run(MINUTE);

    let snapshot = rig.snapshot();
    assert_eq!(rig.total_of("code.exe"), 10_000 + minutes(1));
    assert_eq!(
        snapshot.today.switches, 2,
        "one span before the sleep, one after"
    );
    assert_eq!(
        snapshot.now.unwrap().since_ms,
        NOON_MS + 10_000 + 2 * 3_600_000
    );
}

#[test]
fn the_day_boundary_splits_the_open_span() {
    let rig = Rig::at(MIDNIGHT_MS + DAY_MS - minutes(10));
    rig.start_on(CODE);
    rig.run(20 * MINUTE);

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.day_start_ms, MIDNIGHT_MS + DAY_MS);
    assert_eq!(
        snapshot.today.total_ms,
        minutes(10),
        "only the part after midnight"
    );
    assert_eq!(snapshot.today.switches, 1);
    let week = &snapshot.week;
    assert_eq!(week[WEEK_DAYS - 1].total_ms, minutes(10));
    assert_eq!(
        week[WEEK_DAYS - 2].total_ms,
        minutes(10),
        "yesterday keeps its part"
    );
    assert_eq!(
        snapshot.now.unwrap().since_ms,
        MIDNIGHT_MS + DAY_MS,
        "the new span starts exactly on the boundary"
    );
    assert_eq!(
        rig.stored_sessions().first().map(|(_, _, end)| *end),
        Some(MIDNIGHT_MS + DAY_MS),
        "yesterday's row ends on the boundary"
    );
}

#[test]
fn a_late_reset_hour_moves_the_boundary() {
    let rig = Rig::at(MIDNIGHT_MS + DAY_MS + 2 * 3_600_000);
    rig.set_settings(&ScreenTimeSettings {
        day_reset_hour: 4,
        ..ScreenTimeSettings::default()
    });
    rig.start_on(CODE);
    rig.run(3 * HOUR);

    let snapshot = rig.snapshot();
    assert_eq!(snapshot.day_start_ms, MIDNIGHT_MS + DAY_MS + 4 * 3_600_000);
    assert_eq!(
        snapshot.today.total_ms,
        minutes(60),
        "02:00–04:00 belongs to yesterday"
    );
    assert_eq!(snapshot.week[WEEK_DAYS - 2].total_ms, minutes(120));
}

#[test]
fn the_open_span_is_flushed_every_minute_and_never_counted_twice() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.run(30 * SECOND);
    assert!(rig.stored_sessions().is_empty(), "too early to flush");

    rig.run(31 * SECOND);
    assert_eq!(
        rig.stored_sessions(),
        vec![("code.exe".to_owned(), NOON_MS, NOON_MS + 60_000)],
        "written at the minute, not again a second later"
    );
    assert_eq!(
        rig.total_of("code.exe"),
        61_000,
        "the flushed row stands in for the open span"
    );

    rig.advance(30 * SECOND);
    assert_eq!(rig.total_of("code.exe"), 91_000);
    assert_eq!(rig.stored_sessions().len(), 1, "a snapshot does not write");

    rig.foreground(CHROME);
    assert_eq!(
        rig.stored_sessions(),
        vec![("code.exe".to_owned(), NOON_MS, NOON_MS + 91_000)],
        "closing updates the flushed row"
    );
}

// --- choices -------------------------------------------------------------------------------

#[test]
fn excluding_an_app_forgets_it_and_including_records_it_again() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);
    rig.foreground(CHROME);
    rig.advance(2 * MINUTE);

    let snapshot = rig
        .service
        .command(ScreenTimeCommand::Exclude {
            exe: "Chrome.exe".into(),
        })
        .unwrap();
    assert!(snapshot.apps.iter().all(|app| app.exe != "chrome.exe"));
    assert!(
        snapshot.now.is_none(),
        "an excluded app is not the Now card"
    );
    assert_eq!(snapshot.excluded.len(), 1);
    assert_eq!(snapshot.excluded[0].exe, "chrome.exe");
    assert_eq!(snapshot.excluded[0].name, "Chrome");
    assert_eq!(snapshot.today.total_ms, minutes(5));

    rig.advance(3 * MINUTE);
    rig.service.tick();
    assert_eq!(
        rig.total_of("chrome.exe"),
        0,
        "nothing accrues while excluded"
    );
    rig.foreground(CODE);
    rig.advance(MINUTE);
    rig.foreground(CHROME);
    rig.advance(MINUTE);
    assert_eq!(rig.total_of("chrome.exe"), 0);

    let snapshot = rig
        .service
        .command(ScreenTimeCommand::Include {
            exe: "chrome.exe".into(),
        })
        .unwrap();
    assert!(snapshot.excluded.is_empty());
    assert_eq!(
        snapshot.now.as_ref().map(|now| now.exe.as_str()),
        Some("chrome.exe"),
        "recording starts again at once when it is in the foreground"
    );
    rig.advance(4 * MINUTE);
    assert_eq!(rig.total_of("chrome.exe"), minutes(4));
    assert_eq!(rig.total_of("code.exe"), minutes(6));

    assert!(matches!(
        rig.service.command(ScreenTimeCommand::Exclude {
            exe: "never-seen.exe".into(),
        }),
        Err(ScreenTimeError::Unknown)
    ));
}

#[test]
fn a_daily_limit_publishes_one_notice_per_day() {
    let rig = Rig::new();
    rig.start_on(CODE);
    let snapshot = rig
        .service
        .command(ScreenTimeCommand::SetLimit {
            exe: "code.exe".into(),
            minutes: Some(10),
        })
        .unwrap();
    assert_eq!(
        snapshot.apps.first().and_then(|app| app.limit_minutes),
        None,
        "nothing accrued yet"
    );

    rig.run(5 * MINUTE);
    assert_eq!(rig.shown_notice_id(), None, "half way");
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.apps[0].limit_minutes, Some(10));
    assert!(!snapshot.apps[0].limit_reached);

    rig.run(5 * MINUTE);
    assert_eq!(
        rig.shown_notice_id().as_deref(),
        Some("screen-time:limit:code.exe")
    );
    match rig.hub.current() {
        StripContent::Notice { notice } => assert_eq!(
            notice.wide,
            Some(StripMessage::ScreenTimeLimit {
                app: "Visual Studio Code".into(),
                minutes: 10,
            })
        ),
        other => panic!("expected the limit notice, got {other:?}"),
    }
    assert!(rig.snapshot().apps[0].limit_reached);

    // Staying past the limit does not nag.
    rig.run(MINUTE);
    assert_eq!(rig.strip.notices.lock().len(), 1, "published once");
    // The shell's timer lets the notice run out (NOTICE_HOLD is under a minute).
    assert_eq!(
        rig.hub.refresh(),
        StripContent::Idle,
        "the strip is clear again"
    );

    // Switching away and back does not either, nor does the flushed row double the total.
    rig.foreground(CHROME);
    rig.run(MINUTE);
    rig.foreground(CODE);
    rig.run(MINUTE);
    assert_eq!(rig.strip.notices.lock().len(), 1);
    assert_eq!(rig.hub.current(), StripContent::Idle);

    // Tomorrow it may fire again, once the new day has its own ten minutes on Code. Locked
    // through the night, so the gap is a lock and not a sleep.
    rig.service.set_locked(true);
    rig.advance(12 * HOUR);
    rig.service.set_locked(false);
    rig.run(9 * MINUTE);
    assert_eq!(
        rig.strip.notices.lock().len(),
        1,
        "yesterday's total does not carry over"
    );
    rig.run(MINUTE);
    assert_eq!(rig.strip.notices.lock().len(), 2, "a new day, a new nudge");

    // Clearing the limit clears the flag; an unknown app is refused.
    let snapshot = rig
        .service
        .command(ScreenTimeCommand::SetLimit {
            exe: "code.exe".into(),
            minutes: None,
        })
        .unwrap();
    assert_eq!(snapshot.apps[0].limit_minutes, None);
    assert!(!snapshot.apps[0].limit_reached);
    assert!(matches!(
        rig.service.command(ScreenTimeCommand::SetLimit {
            exe: "never-seen.exe".into(),
            minutes: Some(5),
        }),
        Err(ScreenTimeError::Unknown)
    ));
}

#[test]
fn categories_can_be_overridden_and_clearing_the_history_keeps_choices() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);
    let snapshot = rig
        .service
        .command(ScreenTimeCommand::SetCategory {
            exe: "code.exe".into(),
            category: Some(AppCategory::Games),
        })
        .unwrap();
    assert_eq!(snapshot.apps[0].category, AppCategory::Games);
    assert_eq!(snapshot.categories[0].category, AppCategory::Games);
    rig.service
        .command(ScreenTimeCommand::SetLimit {
            exe: "code.exe".into(),
            minutes: Some(30),
        })
        .unwrap();
    rig.foreground(CHROME);
    rig.advance(MINUTE);
    rig.service
        .command(ScreenTimeCommand::Exclude {
            exe: "chrome.exe".into(),
        })
        .unwrap();
    rig.foreground(STEAM);
    rig.advance(MINUTE);

    let snapshot = rig
        .service
        .command(ScreenTimeCommand::ClearHistory)
        .unwrap();
    assert!(snapshot.apps.is_empty(), "every span is gone");
    assert_eq!(snapshot.today.total_ms, 0);
    assert_eq!(snapshot.excluded.len(), 1, "the exclusion stays");
    assert!(rig.stored_sessions().is_empty());

    // Steam had no choices, so its row went too — and comes back with the open span.
    rig.advance(2 * MINUTE);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.apps.len(), 1);
    assert_eq!(snapshot.apps[0].exe, "steam.exe");
    assert_eq!(snapshot.apps[0].total_ms, minutes(2));
    assert_eq!(snapshot.now.unwrap().since_ms, rig.now_ms() - minutes(2));

    rig.foreground(CODE);
    rig.advance(MINUTE);
    let code = rig
        .snapshot()
        .apps
        .into_iter()
        .find(|app| app.exe == "code.exe")
        .expect("code is back");
    assert_eq!(
        code.category,
        AppCategory::Games,
        "the override survived the clear"
    );
    assert_eq!(code.limit_minutes, Some(30));
    assert_eq!(code.total_ms, minutes(1));

    let back_to_rule = rig
        .service
        .command(ScreenTimeCommand::SetCategory {
            exe: "code.exe".into(),
            category: None,
        })
        .unwrap();
    let code = back_to_rule
        .apps
        .iter()
        .find(|app| app.exe == "code.exe")
        .unwrap();
    assert_eq!(code.category, AppCategory::Development);
}

// --- settings ------------------------------------------------------------------------------

#[test]
fn turning_the_module_off_stops_tracking_and_on_resumes_from_now() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);

    rig.set_settings(&ScreenTimeSettings {
        enabled: false,
        ..ScreenTimeSettings::default()
    });
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Off);
    assert!(snapshot.now.is_none());
    assert_eq!(rig.service.cadence(), None);
    rig.advance(10 * MINUTE);
    rig.service.tick();
    rig.foreground(CHROME);
    rig.advance(MINUTE);
    assert_eq!(rig.total_of("code.exe"), minutes(5));
    assert_eq!(rig.total_of("chrome.exe"), 0, "off means off");

    rig.set_settings(&ScreenTimeSettings::default());
    assert_eq!(rig.service.cadence(), Some(TICK));
    rig.service.tick();
    rig.advance(MINUTE);
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.tracking, Tracking::Active);
    assert_eq!(
        snapshot.now.unwrap().exe,
        "chrome.exe",
        "resumes on the last foreground window"
    );
    assert_eq!(rig.total_of("chrome.exe"), minutes(1));
}

#[test]
fn the_idle_threshold_comes_from_settings() {
    let rig = Rig::new();
    rig.set_settings(&ScreenTimeSettings {
        idle_minutes: 1,
        ..ScreenTimeSettings::default()
    });
    rig.start_on(CODE);
    rig.run(3 * MINUTE);
    rig.platform.set_idle_for(90 * SECOND);
    rig.service.tick();
    assert_eq!(rig.snapshot().tracking, Tracking::Idle);
    assert_eq!(rig.total_of("code.exe"), 90_000);
}

// --- export --------------------------------------------------------------------------------

#[test]
fn export_writes_a_csv_to_the_chosen_folder_and_reveals_it() {
    let rig = Rig::new();
    rig.start_on(CODE);
    rig.advance(5 * MINUTE);
    rig.foreground(CHROME);
    rig.advance(MINUTE);

    rig.platform.set_picked_folder(None);
    assert_eq!(rig.service.export("Export").unwrap(), None, "dismissed");

    let folder = tempfile::tempdir().unwrap();
    rig.platform
        .set_picked_folder(Some(folder.path().to_path_buf()));
    let path = rig
        .service
        .export("Export")
        .unwrap()
        .expect("a file was written");
    assert_eq!(path, folder.path().join("muna-screen-time-2024-06-12.csv"));
    let csv = fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = csv.split("\r\n").filter(|line| !line.is_empty()).collect();
    assert_eq!(lines[0], "start,end,exe,app,category,seconds");
    assert_eq!(
        lines[1],
        "2024-06-12T12:00:00+00:00,2024-06-12T12:05:00+00:00,code.exe,Visual Studio Code,development,300"
    );
    assert_eq!(
        lines[2],
        "2024-06-12T12:05:00+00:00,2024-06-12T12:06:00+00:00,chrome.exe,Chrome,browsing,60",
        "the open span is written up to now"
    );
    assert_eq!(lines.len(), 3);
    assert!(
        rig.platform
            .file_ops_calls()
            .iter()
            .any(|call| matches!(call, FileOpsCall::Reveal(paths) if paths == &vec![path.clone()])),
        "the file is shown in Explorer"
    );
}

// --- publishing ----------------------------------------------------------------------------

#[test]
fn snapshots_are_published_only_while_a_panel_watches() {
    let rig = Rig::new();
    rig.start_on(CODE);
    assert!(rig.sink.snapshots.lock().is_empty(), "nobody is watching");
    assert!(!rig.service.is_watched());

    rig.service.watch("notch-1", true);
    assert!(rig.service.is_watched());
    rig.advance(TICK);
    rig.service.tick();
    let after_tick = rig.sink.snapshots.lock().len();
    assert!(after_tick >= 1, "every tick publishes while watched");
    rig.foreground(CHROME);
    assert!(
        rig.sink.snapshots.lock().len() > after_tick,
        "so does a switch"
    );

    rig.service.watch("notch-1", false);
    assert!(!rig.service.is_watched());
    let quiet = rig.sink.snapshots.lock().len();
    rig.advance(TICK);
    rig.service.tick();
    rig.foreground(CODE);
    assert_eq!(rig.sink.snapshots.lock().len(), quiet, "silent again");

    // A command answers with the snapshot and publishes it even unwatched.
    rig.service.command(ScreenTimeCommand::Refresh).unwrap();
    assert_eq!(rig.sink.snapshots.lock().len(), quiet + 1);

    // A window that went away without closing its panel is forgotten.
    rig.service.watch("notch-2", true);
    rig.service.forget_window("notch-2");
    assert!(!rig.service.is_watched());
}
