//! The `screen-time` module backend (docs/modules/screen-time.md): which app held the
//! foreground, for how long, summed per day, app and category, with per-app daily limits, an
//! *Exclude this app* that forgets the app, and a CSV export. Everything stays in the profile
//! database; window titles are never read into it.
//!
//! Attribution: the platform's `ForegroundChanged` opens a span for the new executable and
//! closes the previous one. A 10 s tick (only while the module is on and the session is
//! unlocked) asks how long the user has been away: past the idle threshold the open span is
//! closed at the moment input stopped, and when input resumes the foreground app is reopened
//! from the moment it did — so an idle gap costs at most one tick of error. Locking closes the
//! span; unlocking reopens the current window. The open span is flushed to the database once a
//! minute, so a crash loses at most that. The day rolls over at the reset hour, splitting the
//! open span exactly on the boundary.
//!
//! Icons are the shell's own picture of the executable, cached as data URLs and only sent
//! while a panel watches.

pub mod categories;
pub mod csv;
pub mod report;
pub mod settings;

use std::collections::{HashMap, HashSet, VecDeque};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::artwork::data_url;
use muna_core::{
    AppSighting, Clock, Glyph, Hub, Int53, Leading, Notice, Settings, Store, StoreError,
    StripMessage, Tint, UsageApp, activities::priority,
};
use muna_platform::{ForegroundWindow, Platform, PlatformError};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use categories::AppCategory;
use report::{DAY_MS, Span, exe_key, name_from_exe};
pub use settings::ScreenTimeSettings;

pub const ID: &str = "screen-time";
/// How often the loop looks at idle time, the day boundary and the open span while on.
pub const TICK: Duration = Duration::from_secs(10);
/// How often the open span is written to the database.
pub const FLUSH_EVERY: Duration = Duration::from_secs(60);
/// Spans shorter than this (an alt-tab passing through) are dropped when they close.
pub const MIN_SESSION: Duration = Duration::from_secs(1);
/// Two ticks further apart than this mean the machine slept: the open span ended at the
/// earlier one.
pub const SLEEP_GAP: Duration = Duration::from_secs(30);
/// How long the history is kept.
pub const RETENTION_DAYS: i64 = 90;
/// How many apps the snapshot ranks.
pub const TOP_APPS: usize = 20;
/// Days in the week view, today included.
pub const WEEK_DAYS: usize = 7;
/// Pixel size the icons are rendered at.
pub const ICON_SIZE: u32 = 64;
/// Most icons kept as data URLs.
pub const ICON_CACHE_ENTRIES: usize = 64;

/// Where local midnight sits relative to UTC at an instant. Injected so tests run at a fixed
/// offset; the app reads the machine's zone (daylight saving included) at every tick.
pub trait Zone: Send + Sync {
    fn offset_seconds(&self, at: SystemTime) -> i32;
}

/// The machine's zone.
#[derive(Debug, Default, Clone, Copy)]
pub struct LocalZone;

impl Zone for LocalZone {
    fn offset_seconds(&self, at: SystemTime) -> i32 {
        chrono::DateTime::<chrono::Local>::from(at)
            .offset()
            .local_minus_utc()
    }
}

/// A zone that never changes, for tests.
#[derive(Debug, Clone, Copy)]
pub struct FixedZone(pub i32);

impl Zone for FixedZone {
    fn offset_seconds(&self, _at: SystemTime) -> i32 {
        self.0
    }
}

/// Whether time is accruing right now, and if not, why.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Tracking {
    Active,
    Idle,
    Locked,
    Off,
}

/// The app in the foreground right now, for the *Now* card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CurrentApp {
    pub exe: String,
    pub name: String,
    pub category: AppCategory,
    /// When this span started (after an idle gap, when input resumed).
    #[specta(type = Int53)]
    pub since_ms: i64,
    /// PNG data URL, when the executable has an icon.
    pub icon: Option<String>,
}

/// The day's headline numbers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayTotals {
    #[specta(type = Int53)]
    pub total_ms: i64,
    /// Spans that touched the day: how often the user switched.
    pub switches: u32,
    #[specta(type = Int53)]
    pub longest_ms: i64,
    #[specta(type = Int53)]
    pub average_ms: i64,
}

/// One row of the app ranking.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub exe: String,
    pub name: String,
    pub category: AppCategory,
    #[specta(type = Int53)]
    pub total_ms: i64,
    pub sessions: u32,
    #[specta(type = Int53)]
    pub longest_ms: i64,
    pub icon: Option<String>,
    /// The daily limit, when one is set.
    pub limit_minutes: Option<u32>,
    /// Today's total is at or past the limit.
    pub limit_reached: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CategoryUsage {
    pub category: AppCategory,
    #[specta(type = Int53)]
    pub total_ms: i64,
}

/// One day of the week view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayUsage {
    #[specta(type = Int53)]
    pub day_start_ms: i64,
    #[specta(type = Int53)]
    pub total_ms: i64,
    pub by_category: Vec<CategoryUsage>,
}

/// An app the user excluded, for the settings pane's list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExcludedApp {
    pub exe: String,
    pub name: String,
}

/// What the panel, the widget and the settings pane render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScreenTimeSnapshot {
    pub tracking: Tracking,
    /// The app accruing time right now; `None` while idle, locked, off, or on an excluded app.
    pub now: Option<CurrentApp>,
    pub today: DayTotals,
    /// Today's apps, most time first, at most [`TOP_APPS`].
    pub apps: Vec<AppUsage>,
    /// Today's categories with time, in legend order.
    pub categories: Vec<CategoryUsage>,
    /// The last [`WEEK_DAYS`] days, oldest first, today last.
    pub week: Vec<DayUsage>,
    pub excluded: Vec<ExcludedApp>,
    /// When today started, so the UI can label the day and its boundary.
    #[specta(type = Int53)]
    pub day_start_ms: i64,
    #[specta(type = Int53)]
    pub generated_at_ms: i64,
}

/// Commands that answer with the snapshot after them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScreenTimeCommand {
    /// Recompute (a panel opening).
    Refresh,
    /// Forget the app's history and stop recording it.
    Exclude { exe: String },
    /// Record the app again from now on.
    Include { exe: String },
    /// Override the category, or `None` to go back to the rule.
    SetCategory {
        exe: String,
        category: Option<AppCategory>,
    },
    /// A daily limit in minutes, or `None` (or 0) for none.
    SetLimit { exe: String, minutes: Option<u32> },
    /// Delete every span; exclusions, categories and limits stay.
    ClearHistory,
}

#[derive(Debug, thiserror::Error)]
pub enum ScreenTimeError {
    #[error("the app is not in the history")]
    Unknown,
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Platform(#[from] PlatformError),
    #[error(transparent)]
    Io(#[from] io::Error),
}

/// Where the module reports a fresh snapshot; the shell bridges it to a Tauri event.
pub trait ScreenTimeSink: Send + Sync {
    fn changed(&self, snapshot: &ScreenTimeSnapshot);
}

/// An executable as the foreground reported it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Sighting {
    /// Lower-case file name, the app key.
    exe: String,
    /// Full path when the platform had it; empty for a protected process.
    path: String,
}

impl Sighting {
    fn of(window: &ForegroundWindow) -> Option<Self> {
        let source = if window.process_path.is_empty() {
            &window.process_name
        } else {
            &window.process_path
        };
        let exe = exe_key(source);
        (!exe.is_empty()).then(|| Self {
            exe,
            path: window.process_path.clone(),
        })
    }
}

/// The span accruing time right now.
#[derive(Debug, Clone, PartialEq, Eq)]
struct OpenSession {
    /// The database row once flushed.
    row_id: Option<i64>,
    exe: String,
    started_at_ms: i64,
    last_flush_ms: i64,
    limit_minutes: Option<u32>,
}

#[derive(Debug)]
struct Tracker {
    locked: bool,
    idle: bool,
    /// Nothing is attributed until the next tick resumes (start-up, after idle, a sleep, an
    /// unlock or the module being switched on).
    paused: bool,
    /// Time cannot be attributed before this (the machine was asleep or locked until then).
    resume_floor_ms: i64,
    /// The last foreground report, kept while paused so resuming knows what to reopen.
    last_foreground: Option<Sighting>,
    /// The executable the foreground is on, excluded or own windows included.
    current: Option<Sighting>,
    open: Option<OpenSession>,
    /// Which day's limit notice went out, per exe.
    limit_notified: HashMap<String, i64>,
    last_prune_day_ms: Option<i64>,
    last_tick_ms: Option<i64>,
}

impl Default for Tracker {
    fn default() -> Self {
        Self {
            locked: false,
            idle: false,
            paused: true,
            resume_floor_ms: 0,
            last_foreground: None,
            current: None,
            open: None,
            limit_notified: HashMap::new(),
            last_prune_day_ms: None,
            last_tick_ms: None,
        }
    }
}

/// Bounded FIFO of icon data URLs by exe; a file without an icon is remembered too, so it is
/// not read again on every snapshot.
#[derive(Debug, Default)]
struct IconCache {
    icons: HashMap<String, Option<String>>,
    order: VecDeque<String>,
}

/// What the cache knows about an exe.
enum Cached {
    /// Never looked at.
    Unknown,
    /// Looked at; `None` when the file has no icon.
    Icon(Option<String>),
}

impl IconCache {
    fn get(&self, exe: &str) -> Cached {
        self.icons
            .get(exe)
            .map_or(Cached::Unknown, |icon| Cached::Icon(icon.clone()))
    }

    fn remember(&mut self, exe: &str, icon: Option<String>) {
        if self.icons.insert(exe.to_owned(), icon).is_none() {
            self.order.push_back(exe.to_owned());
            while self.order.len() > ICON_CACHE_ENTRIES {
                if let Some(oldest) = self.order.pop_front() {
                    self.icons.remove(&oldest);
                }
            }
        }
    }
}

pub struct ScreenTimeService {
    platform: Arc<dyn Platform>,
    hub: Arc<Hub>,
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    zone: Arc<dyn Zone>,
    /// This process's executable name, never attributed.
    own_exe: Option<String>,
    settings: Mutex<ScreenTimeSettings>,
    sink: Mutex<Option<Arc<dyn ScreenTimeSink>>>,
    /// Labels of the notch windows whose panel is open.
    watchers: Mutex<HashSet<String>>,
    tracker: Mutex<Tracker>,
    icons: Mutex<IconCache>,
    /// Wakes the loop when the cadence may have changed.
    pub(crate) wake: Notify,
}

impl std::fmt::Debug for ScreenTimeService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ScreenTimeService")
            .field("settings", &*self.settings.lock())
            .field("watchers", &self.watchers.lock().len())
            .field("tracker", &*self.tracker.lock())
            .finish_non_exhaustive()
    }
}

impl ScreenTimeService {
    #[must_use]
    pub fn new(
        platform: Arc<dyn Platform>,
        hub: Arc<Hub>,
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        zone: Arc<dyn Zone>,
    ) -> Self {
        let own_exe = std::env::current_exe()
            .ok()
            .map(|path| exe_key(&path.to_string_lossy()))
            .filter(|exe| !exe.is_empty());
        Self {
            platform,
            hub,
            store,
            clock,
            zone,
            own_exe,
            settings: Mutex::new(ScreenTimeSettings::default()),
            sink: Mutex::new(None),
            watchers: Mutex::new(HashSet::new()),
            tracker: Mutex::new(Tracker::default()),
            icons: Mutex::new(IconCache::default()),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn ScreenTimeSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> ScreenTimeSettings {
        self.settings.lock().clone()
    }

    /// A panel in the notch window `label` opened (`true`) or closed (`false`); snapshots are
    /// published while any is open.
    pub fn watch(&self, label: &str, watching: bool) {
        let changed = {
            let mut watchers = self.watchers.lock();
            if watching {
                watchers.insert(label.to_owned())
            } else {
                watchers.remove(label)
            }
        };
        if changed {
            self.wake.notify_one();
        }
    }

    /// A notch window went away without closing its panel.
    pub fn forget_window(&self, label: &str) {
        if self.watchers.lock().remove(label) {
            self.wake.notify_one();
        }
    }

    /// `true` while any panel is open.
    #[must_use]
    pub fn is_watched(&self) -> bool {
        !self.watchers.lock().is_empty()
    }

    /// How often to tick, or `None` when nothing can change (off, or locked until the unlock
    /// event).
    #[must_use]
    pub fn cadence(&self) -> Option<Duration> {
        if !self.settings.lock().enabled || self.tracker.lock().locked {
            None
        } else {
            Some(TICK)
        }
    }

    /// Applies `settings.modules["screen-time"]` (start-up and every settings change).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = ScreenTimeSettings::from_document(settings);
        let previous = {
            let mut current = self.settings.lock();
            if *current == next {
                return;
            }
            std::mem::replace(&mut *current, next.clone())
        };
        let now = self.now_ms();
        {
            let mut tracker = self.tracker.lock();
            if previous.enabled && !next.enabled {
                self.pause(&mut tracker, now);
            }
            if !previous.enabled && next.enabled {
                tracker.resume_floor_ms = now;
                tracker.paused = true;
                // The gap while off is not a sleep.
                tracker.last_tick_ms = Some(now);
            }
            if previous.day_reset_hour != next.day_reset_hour {
                tracker.limit_notified.clear();
            }
        }
        self.wake.notify_one();
        self.emit_if_watched();
    }

    /// The platform reported a new foreground window. Blocking (it may read the executable's
    /// description on a first sighting), so the backend calls it from a blocking task.
    pub fn handle_foreground(&self, window: &ForegroundWindow) {
        let Some(sighting) = Sighting::of(window) else {
            return;
        };
        let now = self.now_ms();
        let enabled = self.settings.lock().enabled;
        {
            let mut tracker = self.tracker.lock();
            tracker.last_foreground = Some(sighting.clone());
            if !enabled || tracker.paused {
                return;
            }
            if !self.switch_to(&mut tracker, &sighting, now) {
                return;
            }
        }
        self.emit_if_watched();
    }

    /// The session locked or unlocked.
    pub fn set_locked(&self, locked: bool) {
        let now = self.now_ms();
        {
            let mut tracker = self.tracker.lock();
            if tracker.locked == locked {
                return;
            }
            tracker.locked = locked;
            if locked {
                self.pause(&mut tracker, now);
            } else {
                tracker.idle = false;
                tracker.resume_floor_ms = now;
                // Ticks stop while locked; the gap is not a sleep.
                tracker.last_tick_ms = Some(now);
                if self.settings.lock().enabled {
                    self.resume(&mut tracker, now);
                }
            }
        }
        self.wake.notify_one();
        self.emit_if_watched();
    }

    /// One step of the loop: sleep gaps, idle, the day boundary, the flush, limits and
    /// retention. Blocking — the backend calls it from a blocking task.
    pub fn tick(&self) {
        let settings = self.settings.lock().clone();
        if !settings.enabled {
            return;
        }
        let now = self.now_ms();
        let offset = self.zone.offset_seconds(self.clock.system_time());
        let day_start = report::day_start(now, settings.day_reset_hour, offset);
        {
            let mut tracker = self.tracker.lock();
            if tracker.locked {
                return;
            }
            let gap_ms = i64::try_from(SLEEP_GAP.as_millis()).unwrap_or(i64::MAX);
            if let Some(last) = tracker.last_tick_ms
                && now - last > gap_ms
            {
                self.pause(&mut tracker, last);
                tracker.idle = false;
                tracker.resume_floor_ms = now;
            }
            tracker.last_tick_ms = Some(now);

            let idle_ms = self
                .platform
                .foreground()
                .idle_for()
                .ok()
                .and_then(|idle| i64::try_from(idle.as_millis()).ok())
                .unwrap_or(0);
            let threshold_ms = i64::from(settings.idle_minutes) * 60_000;
            if idle_ms >= threshold_ms {
                if !tracker.idle {
                    tracker.idle = true;
                    self.pause(&mut tracker, now - idle_ms);
                }
            } else {
                tracker.idle = false;
                if tracker.paused {
                    let resumed_at = (now - idle_ms).max(tracker.resume_floor_ms);
                    self.resume(&mut tracker, resumed_at);
                }
            }

            if tracker
                .open
                .as_ref()
                .is_some_and(|open| open.started_at_ms < day_start)
            {
                self.split_at_day_start(&mut tracker, day_start);
            }
            self.flush(&mut tracker, now);
            self.check_limit(&mut tracker, day_start, now);

            if tracker.last_prune_day_ms != Some(day_start) {
                tracker.last_prune_day_ms = Some(day_start);
                if let Err(error) = self.store.prune_usage_before(now - RETENTION_DAYS * DAY_MS) {
                    tracing::warn!(%error, "screen time retention prune failed");
                }
            }
        }
        self.emit_if_watched();
    }

    /// Everything the panel shows. Reads the week's spans, so it runs on a blocking thread.
    pub fn snapshot(&self) -> Result<ScreenTimeSnapshot, ScreenTimeError> {
        let settings = self.settings.lock().clone();
        let now = self.now_ms();
        let offset = self.zone.offset_seconds(self.clock.system_time());
        let today_start = report::day_start(now, settings.day_reset_hour, offset);
        let starts = report::day_starts(today_start, WEEK_DAYS);
        let (tracking, open) = {
            let tracker = self.tracker.lock();
            let tracking = if !settings.enabled {
                Tracking::Off
            } else if tracker.locked {
                Tracking::Locked
            } else if tracker.idle {
                Tracking::Idle
            } else {
                Tracking::Active
            };
            (tracking, tracker.open.clone())
        };

        let apps: HashMap<String, UsageApp> = self
            .store
            .usage_apps()?
            .into_iter()
            .map(|app| (app.exe.clone(), app))
            .collect();
        let sessions =
            self.spans_between(starts[0], now.max(today_start) + DAY_MS, open.as_ref())?;
        let spans: Vec<Span<'_>> = sessions
            .iter()
            .map(|(exe, start, end)| Span {
                exe,
                start_ms: *start,
                end_ms: *end,
            })
            .collect();
        let category_of = |exe: &str| {
            AppCategory::resolve(exe, apps.get(exe).and_then(|app| app.category.as_deref()))
        };
        let day_end = today_start + DAY_MS;

        let totals = report::totals_for_window(&spans, today_start, day_end);
        let ranked_apps = self.rank_apps(&spans, &apps, today_start, day_end, &category_of);
        let categories = category_usage(&spans, today_start, day_end, &category_of);
        let week = starts
            .iter()
            .map(|&start| {
                let end = start + DAY_MS;
                DayUsage {
                    day_start_ms: start,
                    total_ms: report::totals_for_window(&spans, start, end).total_ms,
                    by_category: category_usage(&spans, start, end, &category_of),
                }
            })
            .collect();
        let now_card = open.filter(|_| tracking == Tracking::Active).map(|open| {
            let app = apps.get(&open.exe);
            CurrentApp {
                name: app.map_or_else(|| name_from_exe(&open.exe), |app| app.name.clone()),
                category: category_of(&open.exe),
                since_ms: open.started_at_ms,
                icon: app.and_then(|app| self.icon_for(&open.exe, &app.path)),
                exe: open.exe,
            }
        });
        let mut excluded: Vec<ExcludedApp> = apps
            .values()
            .filter(|app| app.excluded)
            .map(|app| ExcludedApp {
                exe: app.exe.clone(),
                name: app.name.clone(),
            })
            .collect();
        excluded.sort_by_key(|app| app.name.to_lowercase());

        Ok(ScreenTimeSnapshot {
            tracking,
            now: now_card,
            today: DayTotals {
                total_ms: totals.total_ms,
                switches: totals.switches,
                longest_ms: totals.longest_ms,
                average_ms: totals.average_ms,
            },
            apps: ranked_apps,
            categories,
            week,
            excluded,
            day_start_ms: today_start,
            generated_at_ms: now,
        })
    }

    /// Today's apps by time, most used first, capped at [`TOP_APPS`].
    fn rank_apps(
        &self,
        spans: &[Span<'_>],
        apps: &HashMap<String, UsageApp>,
        from_ms: i64,
        to_ms: i64,
        category_of: &dyn Fn(&str) -> AppCategory,
    ) -> Vec<AppUsage> {
        let mut ranked: Vec<(&str, report::AppTotals)> =
            report::totals_by_app(spans, from_ms, to_ms)
                .into_iter()
                .collect();
        ranked.sort_by(|a, b| b.1.total_ms.cmp(&a.1.total_ms).then_with(|| a.0.cmp(b.0)));
        ranked
            .into_iter()
            .take(TOP_APPS)
            .map(|(exe, totals)| {
                let app = apps.get(exe);
                let limit_minutes = app.and_then(|app| app.limit_minutes);
                AppUsage {
                    exe: exe.to_owned(),
                    name: app.map_or_else(|| name_from_exe(exe), |app| app.name.clone()),
                    category: category_of(exe),
                    total_ms: totals.total_ms,
                    sessions: totals.sessions,
                    longest_ms: totals.longest_ms,
                    icon: app.and_then(|app| self.icon_for(exe, &app.path)),
                    limit_minutes,
                    limit_reached: limit_minutes
                        .is_some_and(|minutes| totals.total_ms >= i64::from(minutes) * 60_000),
                }
            })
            .collect()
    }

    /// Runs a command and answers with the snapshot after it.
    pub fn command(
        &self,
        command: ScreenTimeCommand,
    ) -> Result<ScreenTimeSnapshot, ScreenTimeError> {
        let now = self.now_ms();
        match command {
            ScreenTimeCommand::Refresh => {}
            ScreenTimeCommand::Exclude { exe } => {
                let exe = exe.to_ascii_lowercase();
                if !self.store.exclude_usage_app(&exe)? {
                    return Err(ScreenTimeError::Unknown);
                }
                let mut tracker = self.tracker.lock();
                if tracker.open.as_ref().is_some_and(|open| open.exe == exe) {
                    // Its rows are gone with the exclusion; nothing to record.
                    tracker.open = None;
                }
            }
            ScreenTimeCommand::Include { exe } => {
                let exe = exe.to_ascii_lowercase();
                if !self.store.include_usage_app(&exe)? {
                    return Err(ScreenTimeError::Unknown);
                }
                let mut tracker = self.tracker.lock();
                if !tracker.paused
                    && tracker.open.is_none()
                    && tracker
                        .current
                        .as_ref()
                        .is_some_and(|current| current.exe == exe)
                {
                    let limit = self
                        .store
                        .usage_app(&exe)?
                        .and_then(|app| app.limit_minutes);
                    tracker.open = Some(OpenSession {
                        row_id: None,
                        exe,
                        started_at_ms: now,
                        last_flush_ms: now,
                        limit_minutes: limit,
                    });
                }
            }
            ScreenTimeCommand::SetCategory { exe, category } => {
                let exe = exe.to_ascii_lowercase();
                if !self
                    .store
                    .set_usage_app_category(&exe, category.map(AppCategory::as_str))?
                {
                    return Err(ScreenTimeError::Unknown);
                }
            }
            ScreenTimeCommand::SetLimit { exe, minutes } => {
                let exe = exe.to_ascii_lowercase();
                let minutes = minutes.filter(|&minutes| minutes > 0);
                if !self.store.set_usage_app_limit(&exe, minutes)? {
                    return Err(ScreenTimeError::Unknown);
                }
                let mut tracker = self.tracker.lock();
                tracker.limit_notified.remove(&exe);
                if let Some(open) = tracker.open.as_mut()
                    && open.exe == exe
                {
                    open.limit_minutes = minutes;
                }
            }
            ScreenTimeCommand::ClearHistory => {
                let mut tracker = self.tracker.lock();
                self.store.clear_usage()?;
                tracker.limit_notified.clear();
                // The open span starts over: its rows are gone, and so may be its app row.
                let current = tracker.current.clone();
                if let Some(open) = tracker.open.as_mut() {
                    open.row_id = None;
                    open.started_at_ms = now;
                    open.last_flush_ms = now;
                    if let Some(current) = current {
                        self.see_app(&current, now)?;
                    }
                }
            }
        }
        let snapshot = self.snapshot()?;
        self.emit(&snapshot);
        Ok(snapshot)
    }

    /// Asks for a folder, writes `muna-screen-time-<date>.csv` there with every span and shows
    /// it in Explorer. `Ok(None)` when the user dismissed the picker.
    pub fn export(&self, title: &str) -> Result<Option<PathBuf>, ScreenTimeError> {
        let Some(folder) = self.platform.file_ops().pick_folder(0, title)? else {
            return Ok(None);
        };
        let now = self.now_ms();
        let offset = self.zone.offset_seconds(self.clock.system_time());
        let open = self.tracker.lock().open.clone();
        let apps: HashMap<String, UsageApp> = self
            .store
            .usage_apps()?
            .into_iter()
            .map(|app| (app.exe.clone(), app))
            .collect();
        let sessions = self.spans_between(i64::MIN, i64::MAX, open.as_ref())?;
        let rows: Vec<csv::CsvRow<'_>> = sessions
            .iter()
            .map(|(exe, start, end)| {
                let app = apps.get(exe);
                csv::CsvRow {
                    start_ms: *start,
                    end_ms: *end,
                    exe,
                    name: app.map_or("", |app| app.name.as_str()),
                    category: AppCategory::resolve(
                        exe,
                        app.and_then(|app| app.category.as_deref()),
                    )
                    .as_str(),
                }
            })
            .collect();
        let path = folder.join(csv::file_name(now, offset));
        std::fs::write(&path, csv::render(&rows, offset))?;
        if let Err(error) = self.platform.file_ops().reveal(std::slice::from_ref(&path)) {
            tracing::debug!(%error, "could not reveal the screen time export");
        }
        Ok(Some(path))
    }

    /// The stored spans overlapping `[from, to)` with the open span substituted for its
    /// flushed row, as `(exe, start, end)`.
    fn spans_between(
        &self,
        from: i64,
        to: i64,
        open: Option<&OpenSession>,
    ) -> Result<Vec<(String, i64, i64)>, ScreenTimeError> {
        let now = self.now_ms();
        let mut spans: Vec<(String, i64, i64)> = self
            .store
            .usage_sessions_between(from, to)?
            .into_iter()
            .filter(|session| open.and_then(|open| open.row_id) != Some(session.id))
            .map(|session| (session.exe, session.started_at_ms, session.ended_at_ms))
            .collect();
        if let Some(open) = open
            && now > open.started_at_ms
            && open.started_at_ms < to
            && now > from
        {
            spans.push((open.exe.clone(), open.started_at_ms, now));
        }
        Ok(spans)
    }

    fn is_own(&self, exe: &str) -> bool {
        exe == "muna.exe" || exe == "notch.exe" || self.own_exe.as_deref() == Some(exe)
    }

    /// Moves the foreground to `sighting` at `at_ms`: closes the open span and opens one for the
    /// new app unless it is excluded or one of ours. `false` when nothing changed.
    fn switch_to(&self, tracker: &mut Tracker, sighting: &Sighting, at_ms: i64) -> bool {
        if tracker
            .current
            .as_ref()
            .is_some_and(|current| current.exe == sighting.exe)
        {
            return false;
        }
        self.close_open(tracker, at_ms);
        tracker.current = Some(sighting.clone());
        if self.is_own(&sighting.exe) {
            return true;
        }
        let app = match self.see_app(sighting, at_ms) {
            Ok(app) => app,
            Err(error) => {
                tracing::warn!(%error, "screen time could not record the app");
                return true;
            }
        };
        if app.excluded {
            return true;
        }
        tracker.open = Some(OpenSession {
            row_id: None,
            exe: sighting.exe.clone(),
            started_at_ms: at_ms,
            last_flush_ms: at_ms,
            limit_minutes: app.limit_minutes,
        });
        true
    }

    /// Creates or refreshes the app row. The executable is described (name and icon) when it is
    /// new or moved; otherwise only `last_seen` moves.
    fn see_app(&self, sighting: &Sighting, now_ms: i64) -> Result<UsageApp, StoreError> {
        let known = self.store.usage_app(&sighting.exe)?;
        let describe = match &known {
            None => true,
            Some(app) => !sighting.path.is_empty() && app.path.to_string_lossy() != sighting.path,
        };
        let name = if describe {
            self.describe(&sighting.exe, &sighting.path)
        } else {
            String::new()
        };
        self.store.see_usage_app(
            &AppSighting {
                exe: &sighting.exe,
                name: &name,
                path: &sighting.path,
            },
            now_ms,
        )
    }

    /// The executable's display name, caching its icon on the way; a name from the file name
    /// when the file has none or cannot be read.
    fn describe(&self, exe: &str, path: &str) -> String {
        if path.is_empty() {
            return name_from_exe(exe);
        }
        match self
            .platform
            .app_info()
            .describe(Path::new(path), ICON_SIZE)
        {
            Ok(description) => {
                self.icons.lock().remember(
                    exe,
                    description.icon_png.map(|png| data_url(&png, "image/png")),
                );
                description
                    .name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or_else(|| name_from_exe(exe))
            }
            Err(error) => {
                tracing::debug!(%error, "executable description unavailable");
                name_from_exe(exe)
            }
        }
    }

    /// The icon for `exe`, from the cache or read now from `path`.
    fn icon_for(&self, exe: &str, path: &Path) -> Option<String> {
        if let Cached::Icon(cached) = self.icons.lock().get(exe) {
            return cached;
        }
        if path.as_os_str().is_empty() {
            return None;
        }
        let icon = self
            .platform
            .app_info()
            .describe(path, ICON_SIZE)
            .ok()
            .and_then(|description| description.icon_png)
            .map(|png| data_url(&png, "image/png"));
        self.icons.lock().remember(exe, icon.clone());
        icon
    }

    /// Closes the open span at `at_ms`, dropping it when too short.
    fn close_open(&self, tracker: &mut Tracker, at_ms: i64) {
        let Some(open) = tracker.open.take() else {
            return;
        };
        let end = at_ms.max(open.started_at_ms);
        let min_ms = i64::try_from(MIN_SESSION.as_millis()).unwrap_or(1000);
        if end - open.started_at_ms < min_ms {
            if let Some(id) = open.row_id
                && let Err(error) = self.store.delete_usage_session(id)
            {
                tracing::warn!(%error, "screen time could not drop a short span");
            }
            return;
        }
        if let Err(error) =
            self.store
                .record_usage_session(open.row_id, &open.exe, open.started_at_ms, end)
        {
            tracing::warn!(%error, "screen time could not record a span");
        }
    }

    /// Stops attributing at `at_ms` until the next resume.
    fn pause(&self, tracker: &mut Tracker, at_ms: i64) {
        self.close_open(tracker, at_ms);
        tracker.current = None;
        tracker.paused = true;
    }

    /// Attributes again from `at_ms` to whatever is in the foreground now.
    fn resume(&self, tracker: &mut Tracker, at_ms: i64) {
        tracker.paused = false;
        let sighting = self
            .platform
            .foreground()
            .current()
            .ok()
            .flatten()
            .as_ref()
            .and_then(Sighting::of)
            .or_else(|| tracker.last_foreground.clone());
        if let Some(sighting) = sighting {
            tracker.last_foreground = Some(sighting.clone());
            self.switch_to(tracker, &sighting, at_ms);
        }
    }

    /// Ends the open span at the day boundary and starts the same app on the new day.
    fn split_at_day_start(&self, tracker: &mut Tracker, day_start: i64) {
        let Some(open) = tracker.open.clone() else {
            return;
        };
        self.close_open(tracker, day_start);
        tracker.open = Some(OpenSession {
            row_id: None,
            exe: open.exe,
            started_at_ms: day_start,
            last_flush_ms: day_start,
            limit_minutes: open.limit_minutes,
        });
        tracker.limit_notified.clear();
    }

    /// Writes the open span when its last write is [`FLUSH_EVERY`] old.
    fn flush(&self, tracker: &mut Tracker, now_ms: i64) {
        let flush_ms = i64::try_from(FLUSH_EVERY.as_millis()).unwrap_or(60_000);
        let Some(open) = tracker.open.as_mut() else {
            return;
        };
        if now_ms - open.last_flush_ms < flush_ms {
            return;
        }
        match self
            .store
            .record_usage_session(open.row_id, &open.exe, open.started_at_ms, now_ms)
        {
            Ok(id) => {
                open.row_id = Some(id);
                open.last_flush_ms = now_ms;
            }
            Err(error) => tracing::warn!(%error, "screen time flush failed"),
        }
    }

    /// Publishes the limit notice once per day when the open app's total reaches its limit.
    fn check_limit(&self, tracker: &mut Tracker, day_start: i64, now_ms: i64) {
        let Some(open) = tracker.open.clone() else {
            return;
        };
        let Some(minutes) = open.limit_minutes.filter(|&minutes| minutes > 0) else {
            return;
        };
        if tracker.limit_notified.get(&open.exe) == Some(&day_start) {
            return;
        }
        let stored = match self.store.usage_sessions_between(day_start, now_ms) {
            Ok(sessions) => sessions,
            Err(error) => {
                tracing::warn!(%error, "screen time limit check failed");
                return;
            }
        };
        let earlier: i64 = stored
            .iter()
            .filter(|session| session.exe == open.exe && Some(session.id) != open.row_id)
            .map(|session| {
                report::overlap_ms(
                    session.started_at_ms,
                    session.ended_at_ms,
                    day_start,
                    now_ms,
                )
            })
            .sum();
        let total = earlier + (now_ms - open.started_at_ms.max(day_start)).max(0);
        if total < i64::from(minutes) * 60_000 {
            return;
        }
        tracker.limit_notified.insert(open.exe.clone(), day_start);
        let name = self
            .store
            .usage_app(&open.exe)
            .ok()
            .flatten()
            .map_or_else(|| name_from_exe(&open.exe), |app| app.name);
        self.hub
            .publish_notice(limit_notice(&open.exe, &name, minutes));
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    fn emit(&self, snapshot: &ScreenTimeSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }

    fn emit_if_watched(&self) {
        if !self.is_watched() {
            return;
        }
        match self.snapshot() {
            Ok(snapshot) => self.emit(&snapshot),
            Err(error) => tracing::warn!(%error, "screen time snapshot failed"),
        }
    }
}

/// The strip notice for a daily limit reached: an hourglass and the app's name.
#[must_use]
pub fn limit_notice(exe: &str, name: &str, minutes: u32) -> Notice {
    Notice {
        id: format!("{ID}:limit:{exe}"),
        module: ID.into(),
        priority: priority::SCREEN_TIME_LIMIT,
        leading: Some(Leading::Icon {
            glyph: Glyph::Hourglass,
            tint: Some(Tint::Orange),
        }),
        trailing: None,
        wide: Some(StripMessage::ScreenTimeLimit {
            app: name.to_owned(),
            minutes,
        }),
        hold_ms: 0,
    }
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// Time per category within `[from_ms, to_ms)`, largest first, for the donut and the week.
fn category_usage(
    spans: &[Span<'_>],
    from_ms: i64,
    to_ms: i64,
    category_of: &dyn Fn(&str) -> AppCategory,
) -> Vec<CategoryUsage> {
    report::totals_by_category(spans, from_ms, to_ms, category_of)
        .into_iter()
        .map(|(category, total_ms)| CategoryUsage { category, total_ms })
        .collect()
}

/// The backend: follows foreground and lock events and ticks while the module is on.
#[derive(Debug, Clone)]
pub struct ScreenTimeModule(pub Arc<ScreenTimeService>);

impl ModuleBackend for ScreenTimeModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        tauri::async_runtime::spawn(async move {
            loop {
                let Some(period) = service.cadence() else {
                    service.wake.notified().await;
                    continue;
                };
                let ticker = Arc::clone(&service);
                // Database writes and the occasional executable read stay off the async threads.
                if let Err(error) =
                    tauri::async_runtime::spawn_blocking(move || ticker.tick()).await
                {
                    tracing::warn!(%error, "screen time tick task failed");
                }
                tokio::select! {
                    () = tokio::time::sleep(period) => {}
                    () = service.wake.notified() => {}
                }
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(muna_platform::PlatformEvent::ForegroundChanged(window)) => {
                        let handler = Arc::clone(&service);
                        // Awaited so reports are applied in the order they arrived.
                        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
                            handler.handle_foreground(&window);
                        })
                        .await
                        {
                            tracing::warn!(%error, "screen time foreground task failed");
                        }
                    }
                    Ok(muna_platform::PlatformEvent::SessionLockChanged { locked }) => {
                        let handler = Arc::clone(&service);
                        if let Err(error) = tauri::async_runtime::spawn_blocking(move || {
                            handler.set_locked(locked);
                        })
                        .await
                        {
                            tracing::warn!(%error, "screen time lock task failed");
                        }
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "screen time events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
