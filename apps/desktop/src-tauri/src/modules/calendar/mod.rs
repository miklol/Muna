//! The `calendar` module backend (docs/modules/calendar.md), first slice: read-only ICS
//! subscriptions. Each source is fetched on the refresh period, expanded to occurrences for a
//! window around today, kept in the store so an offline start renders the last feed with its
//! time, and the next timed event within the hour takes the strip.
//!
//! [`CalendarService`] is a reducer like the weather one: everything that decides is
//! synchronous and reads the clock through `muna_core::Clock`, so `tests/calendar.rs` drives
//! it step by step with a `FakeClock` and scripted feeds. The only asynchronous part — the
//! request — happens in the backend loop between [`CalendarService::plan`] and
//! [`CalendarService::complete_fetch`].
//!
//! Privacy (`.github/copilot-instructions.md`, "local-first & private"): nothing is requested
//! until the user adds a source; a source's address is a bearer secret and lives in the
//! Credential Manager (`muna_platform::Secrets`), never in `settings.json` or a log; event
//! titles are content and are never logged.

pub mod fetch;
pub mod ics;
pub mod settings;

use std::collections::{BTreeMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{
    Activity, Clock, Glyph, Hub, Int53, Leading, Notice, Settings, Store, StripMessage, Tint,
    Trailing, activities::priority,
};
use muna_platform::{Platform, PlatformEvent, PlatformResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use fetch::{FeedError, HttpIcsFetcher, IcsFetcher, UrlError, normalise_url};
pub use settings::{CalendarSettings, SourceSetting, secret_key};

pub const ID: &str = "calendar";
/// The activity for the next timed event within [`LEAD`].
pub const NEXT_ACTIVITY_ID: &str = "calendar:next";

/// How far ahead of its start an event takes the strip.
pub const LEAD: Duration = Duration::from_mins(60);
/// From this close to the start the activity outranks playing media and the ten-minute
/// notice fires.
pub const STARTING_LEAD: Duration = Duration::from_mins(10);
/// How long an event stays in the strip after its start.
pub const GRACE: Duration = Duration::from_mins(15);
/// The window occurrences are expanded for, either side of now.
pub const WINDOW_BEHIND: Duration = Duration::from_hours(60 * 24);
pub const WINDOW_AHEAD: Duration = WINDOW_BEHIND;
/// The first wait after a failed fetch; doubles per failure up to the refresh period.
pub const RETRY_BASE: Duration = Duration::from_mins(1);

/// The `meta` key a source's last good feed is kept under.
#[must_use]
pub fn cache_key(source_id: &str) -> String {
    format!("calendar:cache:{source_id}")
}

/// The notice id for an event ten minutes out.
#[must_use]
pub fn starting_notice_id(event_id: &str) -> String {
    format!("calendar:starting:{event_id}")
}

/// Where a source stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SourceStatus {
    /// Not fetched yet this launch (the cache, if any, is showing).
    Idle,
    /// A request is on the wire.
    Fetching,
    /// The last fetch worked.
    Ok,
    /// The last fetch failed; the cached events, if any, stay. `MissingLink` is not retried.
    Error { error: FeedError },
}

/// A source as the UI shows it: the setting plus the fetch state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SourceView {
    pub id: String,
    pub name: String,
    pub color: Tint,
    pub enabled: bool,
    pub host: String,
    pub status: SourceStatus,
    /// When the showing events were fetched, Unix milliseconds.
    #[specta(type = Option<Int53>)]
    pub fetched_at_ms: Option<i64>,
    /// Occurrences inside the window.
    pub event_count: u32,
}

/// One occurrence inside the window, as the panel, the widget and the strip see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    /// `<source id>:<uid>:<start>`; stable across refreshes for the same instance.
    pub id: String,
    pub source_id: String,
    /// Empty when the feed had no summary; the UI names it.
    pub title: String,
    pub location: Option<String>,
    #[specta(type = Int53)]
    pub start_ms: i64,
    #[specta(type = Int53)]
    pub end_ms: i64,
    pub all_day: bool,
    /// A meeting link or the event's URL; opened through `calendar_open`, never rendered as a
    /// navigable link inside the webview.
    pub link: Option<String>,
    pub is_meeting: bool,
}

/// What the UI renders (docs/modules/calendar.md).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CalendarSnapshot {
    pub sources: Vec<SourceView>,
    /// Every occurrence from enabled sources, chronological.
    pub events: Vec<CalendarEvent>,
    #[specta(type = Int53)]
    pub window_start_ms: i64,
    #[specta(type = Int53)]
    pub window_end_ms: i64,
    /// Some enabled source could not be reached on its last fetch.
    pub offline: bool,
}

/// What the panel can ask for. Sources and options go through the settings document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CalendarCommand {
    /// Fetches every enabled source now, whatever the schedule says.
    Refresh,
}

/// Why a source could not be added.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum AddSourceError {
    #[error(transparent)]
    Url(#[from] UrlError),
    /// The Credential Manager refused the write; nothing was kept.
    #[error("the address could not be stored in the credential vault")]
    Vault,
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait CalendarSink: Send + Sync {
    fn changed(&self, snapshot: &CalendarSnapshot);
}

/// One step of asynchronous work the backend loop runs for the service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Job {
    /// Fetch one source; the loop reads its address with [`CalendarService::feed_url`].
    Fetch { source_id: String },
}

/// A source's last good feed as kept in the store: the text itself, so a later window (the
/// day after, offline) can be expanded from it.
#[derive(Serialize, Deserialize)]
struct CacheEntry {
    fetched_at_ms: i64,
    text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Idle,
    Fetching { generation: u64 },
    Ok,
    Error(FeedError),
}

#[derive(Debug)]
struct SourceState {
    status: Status,
    fetched_at_ms: Option<i64>,
    /// Wall time the next fetch may run; `None` when one is wanted as soon as the loop runs.
    due_at_ms: Option<i64>,
    /// Consecutive fetches that failed; sets the wait before the next.
    failures: u32,
    /// The feed's occurrences inside the window, chronological.
    events: Vec<ics::Occurrence>,
    /// The feed text the events came from, kept so a new window can be expanded offline.
    text: Option<String>,
    force: bool,
}

impl SourceState {
    fn fresh() -> Self {
        Self {
            status: Status::Idle,
            fetched_at_ms: None,
            due_at_ms: None,
            failures: 0,
            events: Vec::new(),
            text: None,
            force: false,
        }
    }
}

struct Inner {
    settings: CalendarSettings,
    /// Bumped when a source is removed or disabled, so a result that started under the old
    /// settings is dropped.
    generation: u64,
    sources: BTreeMap<String, SourceState>,
    window: (i64, i64),
    /// The event the strip activity currently names: its id, start and published priority.
    showing: Option<(String, i64, u8)>,
    /// Events whose ten-minute notice went out this launch.
    announced: HashSet<String>,
    last_evaluated_ms: Option<i64>,
}

pub struct CalendarService {
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    hub: Arc<Hub>,
    platform: Arc<dyn Platform>,
    inner: Mutex<Inner>,
    sink: Mutex<Option<Arc<dyn CalendarSink>>>,
    /// Wakes the backend loop after a command or a settings change.
    wake: Notify,
    minted: AtomicU64,
}

impl std::fmt::Debug for CalendarService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("CalendarService")
            .field("sources", &inner.sources.len())
            .field("refresh_minutes", &inner.settings.refresh_minutes)
            .finish_non_exhaustive()
    }
}

impl CalendarService {
    #[must_use]
    pub fn new(
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        hub: Arc<Hub>,
        platform: Arc<dyn Platform>,
    ) -> Self {
        let now = unix_ms(clock.system_time());
        Self {
            store,
            clock,
            hub,
            platform,
            inner: Mutex::new(Inner {
                settings: CalendarSettings::default(),
                generation: 0,
                sources: BTreeMap::new(),
                window: window_of(now),
                showing: None,
                announced: HashSet::new(),
                last_evaluated_ms: None,
            }),
            sink: Mutex::new(None),
            wake: Notify::new(),
            minted: AtomicU64::new(0),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn CalendarSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> CalendarSettings {
        self.inner.lock().settings.clone()
    }

    #[must_use]
    pub fn snapshot(&self) -> CalendarSnapshot {
        snapshot_of(&self.inner.lock())
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    /// Applies `settings.modules.calendar` (start-up and every settings change). A new source
    /// restores its cache and is fetched as soon as the loop runs; a removed one loses its
    /// cache (the caller removes the secret); a disabled one keeps both but is neither fetched
    /// nor shown.
    pub fn apply_settings(&self, settings: &Settings) {
        let next = CalendarSettings::from_document(settings);
        let snapshot = {
            let mut guard = self.inner.lock();
            let inner = &mut *guard;
            if inner.settings == next {
                return;
            }
            let previous = std::mem::replace(&mut inner.settings, next);
            let kept: HashSet<&str> = inner
                .settings
                .sources
                .iter()
                .map(|source| source.id.as_str())
                .collect();
            let removed: Vec<String> = previous
                .sources
                .iter()
                .filter(|source| !kept.contains(source.id.as_str()))
                .map(|source| source.id.clone())
                .collect();
            let mut bump = !removed.is_empty();
            for id in &removed {
                inner.sources.remove(id);
                if let Err(error) = self.store.remove_meta(&cache_key(id)) {
                    tracing::warn!(%error, "calendar cache could not be removed");
                }
            }
            let refresh = inner.settings.refresh();
            for source in &inner.settings.sources {
                let was_enabled = previous
                    .source(&source.id)
                    .is_none_or(|before| before.enabled);
                if was_enabled && !source.enabled {
                    bump = true;
                }
                if !inner.sources.contains_key(&source.id) {
                    let mut state = SourceState::fresh();
                    self.adopt_cache(&source.id, &mut state, inner.window, refresh);
                    inner.sources.insert(source.id.clone(), state);
                }
            }
            if bump {
                inner.generation += 1;
                for state in inner.sources.values_mut() {
                    if let Status::Fetching { .. } = state.status {
                        state.status = Status::Idle;
                    }
                }
            }
            snapshot_of(inner)
        };
        self.evaluate();
        self.publish(&snapshot);
    }

    /// Runs one command and returns the snapshot after it.
    pub fn command(&self, command: CalendarCommand) -> CalendarSnapshot {
        let snapshot = {
            let mut inner = self.inner.lock();
            match command {
                CalendarCommand::Refresh => {
                    for state in inner.sources.values_mut() {
                        state.force = true;
                        state.failures = 0;
                    }
                }
            }
            snapshot_of(&inner)
        };
        tracing::debug!(?command, "calendar command");
        self.publish(&snapshot);
        snapshot
    }

    /// Checks and stores a new source: the address goes to the vault under its fresh id, and
    /// the returned setting is what the caller appends to `settings.modules.calendar.sources`.
    pub fn add_source(
        &self,
        name: &str,
        url: &str,
        color: Tint,
    ) -> Result<SourceSetting, AddSourceError> {
        let (url, host) = normalise_url(url)?;
        let id = self.mint_id(&url);
        self.platform
            .secrets()
            .set(&secret_key(&id), &url)
            .map_err(|error| {
                tracing::warn!(%error, "calendar source address could not be stored");
                AddSourceError::Vault
            })?;
        let name = settings::trim_name(name);
        tracing::info!(%host, "calendar source added");
        Ok(SourceSetting {
            id,
            name: if name.is_empty() { host.clone() } else { name },
            color,
            enabled: true,
            host,
        })
    }

    /// Forgets a removed source's address. Called after the settings without it were saved,
    /// so a failed save never orphans the settings entry.
    pub fn remove_source_secret(&self, source_id: &str) -> PlatformResult<()> {
        self.platform.secrets().remove(&secret_key(source_id))
    }

    /// The address to fetch `source_id` from, for the backend loop. `Ok(None)` when the vault
    /// has no entry for it.
    pub fn feed_url(&self, source_id: &str) -> PlatformResult<Option<String>> {
        self.platform.secrets().get(&secret_key(source_id))
    }

    /// The link for an event, when it has one the opener may be handed.
    #[must_use]
    pub fn link_for(&self, event_id: &str) -> Option<String> {
        let inner = self.inner.lock();
        inner
            .settings
            .sources
            .iter()
            .filter(|source| source.enabled)
            .filter_map(|source| inner.sources.get(&source.id).map(|state| (source, state)))
            .flat_map(|(source, state)| {
                state
                    .events
                    .iter()
                    .map(move |occurrence| (event_id_of(&source.id, occurrence), occurrence))
            })
            .find(|(id, _)| id == event_id)
            .and_then(|(_, occurrence)| occurrence.link.clone())
            .filter(|link| ics::is_web_url(link))
    }

    /// What the loop should do now, if anything; marks it in flight. The matching
    /// [`Self::complete_fetch`] must follow before the next `plan` fetches the same source.
    pub fn plan(&self) -> Option<Job> {
        let now = self.now_ms();
        let (job, snapshot) = {
            let mut guard = self.inner.lock();
            let inner = &mut *guard;
            let Schedule::Now(job) = schedule(inner, now) else {
                return None;
            };
            let Job::Fetch { source_id } = &job;
            let generation = inner.generation;
            if let Some(state) = inner.sources.get_mut(source_id) {
                state.status = Status::Fetching { generation };
                state.force = false;
            }
            (job, snapshot_of(inner))
        };
        self.notify(&snapshot);
        Some(job)
    }

    /// How long the loop may sleep: `None` until a command or a settings change wakes it,
    /// zero when a job is due, otherwise until the next fetch or strip boundary.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let now = self.now_ms();
        let inner = self.inner.lock();
        let mut soonest: Option<i64> = match schedule(&inner, now) {
            Schedule::Never => None,
            Schedule::Now(_) => return Some(Duration::ZERO),
            Schedule::At(at) => Some(at),
        };
        let mut consider = |at: i64| {
            if at > now {
                soonest = Some(soonest.map_or(at, |current| current.min(at)));
            }
        };
        if inner.settings.show_next_in_strip || inner.settings.notices {
            for (_, occurrence) in enabled_occurrences(&inner) {
                if occurrence.all_day || occurrence.start_ms + duration_ms(GRACE) <= now {
                    continue;
                }
                consider(occurrence.start_ms - duration_ms(LEAD));
                consider(occurrence.start_ms - duration_ms(STARTING_LEAD));
                consider(occurrence.start_ms + duration_ms(GRACE));
                if occurrence.start_ms - duration_ms(LEAD) > now {
                    // Events are chronological; nothing later comes sooner.
                    break;
                }
            }
        }
        soonest.map(|at| Duration::from_millis(u64::try_from(at - now).unwrap_or(0)))
    }

    /// The outcome of a [`Job::Fetch`]. The text is expanded before the lock is taken.
    pub fn complete_fetch(&self, source_id: &str, result: Result<String, FeedError>) {
        let now = self.now_ms();
        let window = window_of(now);
        let result = result.map(|text| {
            let events = ics::expand(&text, window.0, window.1);
            (text, events)
        });
        let snapshot = {
            let mut guard = self.inner.lock();
            let inner = &mut *guard;
            let current_generation = inner.generation;
            let refresh = inner.settings.refresh();
            let Some(state) = inner.sources.get_mut(source_id) else {
                tracing::debug!("calendar fetch completed for a removed source; dropped");
                return;
            };
            let Status::Fetching { generation } = state.status else {
                tracing::warn!("calendar fetch completed without one in flight");
                return;
            };
            if generation != current_generation {
                tracing::debug!("calendar fetch outlived its settings; dropped");
                state.status = Status::Idle;
                return;
            }
            state.force = false;
            match result {
                Ok((text, events)) => {
                    tracing::info!(events = events.len(), "calendar source fetched");
                    state.events = events;
                    state.text = Some(text);
                    state.fetched_at_ms = Some(now);
                    state.status = Status::Ok;
                    state.failures = 0;
                    state.due_at_ms = Some(now + duration_ms(refresh));
                    inner.window = window;
                    self.persist_cache(source_id, state);
                }
                Err(FeedError::MissingLink) => {
                    tracing::warn!("calendar source address missing from the vault");
                    state.status = Status::Error(FeedError::MissingLink);
                    state.due_at_ms = None;
                }
                Err(error) => {
                    state.failures += 1;
                    state.status = Status::Error(error);
                    state.due_at_ms = Some(now + duration_ms(backoff(state.failures, refresh)));
                    tracing::warn!(%error, failures = state.failures, "calendar fetch failed");
                }
            }
            snapshot_of(inner)
        };
        self.evaluate();
        self.publish(&snapshot);
    }

    /// Announces events that reached the ten-minute mark since the last evaluation and points
    /// the strip activity at the next timed event within [`LEAD`]. Called after every fetch,
    /// command and settings change, at every strip boundary and on unlock.
    pub fn evaluate(&self) {
        let now = self.now_ms();
        let mut guard = self.inner.lock();
        let inner = &mut *guard;
        let last = inner.last_evaluated_ms.replace(now);
        let settings = inner.settings.clone();

        let mut notices = Vec::new();
        if settings.notices
            && let Some(last) = last
            && last < now
        {
            let lead = duration_ms(STARTING_LEAD);
            let due: Vec<(String, ics::Occurrence, Tint)> = enabled_occurrences(inner)
                .filter(|(_, occurrence)| {
                    !occurrence.all_day
                        && occurrence.start_ms - lead > last
                        && occurrence.start_ms - lead <= now
                })
                .map(|(source, occurrence)| {
                    (
                        event_id_of(&source.id, occurrence),
                        occurrence.clone(),
                        source.color,
                    )
                })
                .collect();
            for (id, occurrence, color) in due {
                if inner.announced.insert(id.clone()) {
                    notices.push(starting_notice(&id, &occurrence, color));
                }
            }
        }

        let next = if settings.show_next_in_strip {
            let grace = duration_ms(GRACE);
            let lead = duration_ms(LEAD);
            enabled_occurrences(inner)
                .filter(|(_, occurrence)| {
                    !occurrence.all_day
                        && occurrence.start_ms + grace > now
                        && occurrence.start_ms <= now + lead
                })
                .map(|(source, occurrence)| {
                    (
                        event_id_of(&source.id, occurrence),
                        occurrence.clone(),
                        source.color,
                    )
                })
                .next()
        } else {
            None
        };
        let activity = if let Some((id, occurrence, color)) = next {
            let starting = occurrence.start_ms - duration_ms(STARTING_LEAD) <= now;
            let priority = if starting {
                priority::EVENT_STARTING
            } else {
                priority::EVENT_UPCOMING
            };
            let key = (id, occurrence.start_ms, priority);
            if inner.showing.as_ref() == Some(&key) {
                None
            } else {
                inner.showing = Some(key);
                Some(next_activity(&occurrence, color, priority))
            }
        } else {
            if inner.showing.take().is_some() {
                self.hub.retract_activity(NEXT_ACTIVITY_ID);
            }
            None
        };
        drop(guard);
        for notice in notices {
            self.hub.publish_notice(notice);
        }
        if let Some(activity) = activity {
            self.hub.publish_activity(activity);
        }
    }

    /// Wakes the loop so it re-reads the schedule (after a sleep or an unlock, a fetch may be
    /// overdue and the strip stale).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    fn mint_id(&self, url: &str) -> String {
        let mut hasher = DefaultHasher::new();
        self.now_ms().hash(&mut hasher);
        url.hash(&mut hasher);
        self.minted
            .fetch_add(1, Ordering::Relaxed)
            .hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }

    /// Restores a source's last feed from the store, expanded for the current window. A
    /// restored feed keeps its own refresh time, so an old one is fetched again as soon as
    /// the loop runs.
    fn adopt_cache(
        &self,
        source_id: &str,
        state: &mut SourceState,
        window: (i64, i64),
        refresh: Duration,
    ) {
        let json = match self.store.get_meta(&cache_key(source_id)) {
            Ok(Some(json)) => json,
            Ok(None) => return,
            Err(error) => {
                tracing::warn!(%error, "calendar cache unreadable");
                return;
            }
        };
        let Ok(entry) = serde_json::from_str::<CacheEntry>(&json)
            .map_err(|error| tracing::warn!(%error, "calendar cache malformed; ignored"))
        else {
            return;
        };
        tracing::debug!("calendar source restored from the cache");
        state.events = ics::expand(&entry.text, window.0, window.1);
        state.text = Some(entry.text);
        state.fetched_at_ms = Some(entry.fetched_at_ms);
        state.due_at_ms = Some(entry.fetched_at_ms + duration_ms(refresh));
    }

    fn persist_cache(&self, source_id: &str, state: &SourceState) {
        let (Some(text), Some(fetched_at_ms)) = (&state.text, state.fetched_at_ms) else {
            return;
        };
        let entry = CacheEntry {
            fetched_at_ms,
            text: text.clone(),
        };
        match serde_json::to_string(&entry) {
            Ok(json) => {
                if let Err(error) = self.store.set_meta(&cache_key(source_id), &json) {
                    tracing::warn!(%error, "calendar cache could not be written");
                }
            }
            Err(error) => tracing::warn!(%error, "calendar cache could not be serialised"),
        }
    }

    fn notify(&self, snapshot: &CalendarSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }

    /// Tells the sink and wakes the loop.
    fn publish(&self, snapshot: &CalendarSnapshot) {
        self.notify(snapshot);
        self.wake.notify_one();
    }
}

enum Schedule {
    Now(Job),
    /// Nothing until this wall time (Unix milliseconds).
    At(i64),
    Never,
}

/// The next fetch across enabled sources: a forced or never-fetched one now, else the
/// earliest due. Sources without an address and sources in flight are skipped.
fn schedule(inner: &Inner, now: i64) -> Schedule {
    let mut earliest: Option<i64> = None;
    for source in inner
        .settings
        .sources
        .iter()
        .filter(|source| source.enabled)
    {
        let Some(state) = inner.sources.get(&source.id) else {
            continue;
        };
        match state.status {
            Status::Fetching { .. } | Status::Error(FeedError::MissingLink) => continue,
            Status::Idle | Status::Ok | Status::Error(_) => {}
        }
        if state.force {
            return Schedule::Now(Job::Fetch {
                source_id: source.id.clone(),
            });
        }
        match state.due_at_ms {
            Some(due) if due > now => {
                earliest = Some(earliest.map_or(due, |current| current.min(due)));
            }
            _ => {
                return Schedule::Now(Job::Fetch {
                    source_id: source.id.clone(),
                });
            }
        }
    }
    earliest.map_or(Schedule::Never, Schedule::At)
}

/// Occurrences of enabled sources, chronological, each with its source.
fn enabled_occurrences(inner: &Inner) -> impl Iterator<Item = (&SourceSetting, &ics::Occurrence)> {
    let mut all: Vec<(&SourceSetting, &ics::Occurrence)> = inner
        .settings
        .sources
        .iter()
        .filter(|source| source.enabled)
        .filter_map(|source| inner.sources.get(&source.id).map(|state| (source, state)))
        .flat_map(|(source, state)| state.events.iter().map(move |event| (source, event)))
        .collect();
    all.sort_by(|a, b| {
        a.1.start_ms
            .cmp(&b.1.start_ms)
            .then_with(|| a.1.end_ms.cmp(&b.1.end_ms))
            .then_with(|| a.1.title.cmp(&b.1.title))
    });
    all.into_iter()
}

fn snapshot_of(inner: &Inner) -> CalendarSnapshot {
    let sources = inner
        .settings
        .sources
        .iter()
        .map(|source| {
            let state = inner.sources.get(&source.id);
            SourceView {
                id: source.id.clone(),
                name: source.name.clone(),
                color: source.color,
                enabled: source.enabled,
                host: source.host.clone(),
                status: match state.map(|state| state.status) {
                    None | Some(Status::Idle) => SourceStatus::Idle,
                    Some(Status::Fetching { .. }) => SourceStatus::Fetching,
                    Some(Status::Ok) => SourceStatus::Ok,
                    Some(Status::Error(error)) => SourceStatus::Error { error },
                },
                fetched_at_ms: state.and_then(|state| state.fetched_at_ms),
                event_count: state.map_or(0, |state| {
                    u32::try_from(state.events.len()).unwrap_or(u32::MAX)
                }),
            }
        })
        .collect::<Vec<_>>();
    let offline = sources.iter().any(|source| {
        source.enabled
            && source.status
                == SourceStatus::Error {
                    error: FeedError::Offline,
                }
    });
    CalendarSnapshot {
        sources,
        events: enabled_occurrences(inner)
            .map(|(source, occurrence)| CalendarEvent {
                id: event_id_of(&source.id, occurrence),
                source_id: source.id.clone(),
                title: occurrence.title.clone(),
                location: occurrence.location.clone(),
                start_ms: occurrence.start_ms,
                end_ms: occurrence.end_ms,
                all_day: occurrence.all_day,
                link: occurrence.link.clone(),
                is_meeting: occurrence.is_meeting,
            })
            .collect(),
        window_start_ms: inner.window.0,
        window_end_ms: inner.window.1,
        offline,
    }
}

/// `<source id>:<uid>:<start>`.
#[must_use]
pub fn event_id_of(source_id: &str, occurrence: &ics::Occurrence) -> String {
    format!("{source_id}:{}:{}", occurrence.uid, occurrence.start_ms)
}

/// The strip activity for the next event: the calendar glyph in the source's colour, the
/// start time on the right and the title in the wide form.
#[must_use]
pub fn next_activity(occurrence: &ics::Occurrence, color: Tint, priority: u8) -> Activity {
    Activity {
        id: NEXT_ACTIVITY_ID.into(),
        module: ID.into(),
        priority,
        leading: Some(Leading::Icon {
            glyph: Glyph::Calendar,
            tint: Some(color),
        }),
        trailing: Some(Trailing::Time {
            at_ms: occurrence.start_ms,
        }),
        wide: Some(StripMessage::EventStarting {
            title: occurrence.title.clone(),
        }),
    }
}

/// The notice ten minutes before an event; holds the strip for the default 4 s.
#[must_use]
pub fn starting_notice(event_id: &str, occurrence: &ics::Occurrence, color: Tint) -> Notice {
    Notice {
        id: starting_notice_id(event_id),
        module: ID.into(),
        priority: priority::EVENT_STARTING,
        leading: Some(Leading::Icon {
            glyph: Glyph::Calendar,
            tint: Some(color),
        }),
        trailing: Some(Trailing::Time {
            at_ms: occurrence.start_ms,
        }),
        wide: Some(StripMessage::EventStarting {
            title: occurrence.title.clone(),
        }),
        hold_ms: 0,
    }
}

/// The wait after the `attempt`th consecutive failure: 1, 2, 4, 8 minutes, then the refresh
/// period (or the refresh period itself when that is shorter).
#[must_use]
pub fn backoff(attempt: u32, refresh: Duration) -> Duration {
    let doublings = attempt.saturating_sub(1).min(8);
    (RETRY_BASE * 2u32.pow(doublings)).min(refresh)
}

/// The expansion window around `now`.
#[must_use]
pub fn window_of(now: i64) -> (i64, i64) {
    (
        now - duration_ms(WINDOW_BEHIND),
        now + duration_ms(WINDOW_AHEAD),
    )
}

fn duration_ms(duration: Duration) -> i64 {
    i64::try_from(duration.as_millis()).unwrap_or(i64::MAX)
}

fn unix_ms(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

/// The backend: runs the refresh loop, re-evaluates the strip at every boundary and re-checks
/// the schedule after an unlock.
#[derive(Clone)]
pub struct CalendarModule {
    pub service: Arc<CalendarService>,
    pub fetcher: Arc<dyn IcsFetcher>,
}

impl std::fmt::Debug for CalendarModule {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CalendarModule")
            .field("service", &self.service)
            .field("fetcher", &self.fetcher.name())
            .finish()
    }
}

impl ModuleBackend for CalendarModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Strip, Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.service);
        let fetcher = Arc::clone(&self.fetcher);
        tauri::async_runtime::spawn(async move {
            loop {
                service.evaluate();
                match service.next_wake() {
                    None => service.wake.notified().await,
                    Some(wait) if !wait.is_zero() => {
                        tokio::select! {
                            () = tokio::time::sleep(wait) => {}
                            () = service.wake.notified() => {}
                        }
                    }
                    Some(_) => {}
                }
                while let Some(Job::Fetch { source_id }) = service.plan() {
                    let result = match service.feed_url(&source_id) {
                        Ok(Some(url)) => fetcher.fetch(url).await,
                        Ok(None) => Err(FeedError::MissingLink),
                        Err(error) => {
                            tracing::warn!(%error, "calendar vault unreadable");
                            Err(FeedError::MissingLink)
                        }
                    };
                    service.complete_fetch(&source_id, result);
                }
            }
        });
        let service = Arc::clone(&self.service);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(PlatformEvent::SessionLockChanged { locked: false }) => service.wake(),
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "calendar events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
