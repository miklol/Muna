//! The `weather` module backend (docs/modules/weather.md): a forecast for one place from
//! Open-Meteo, refreshed every quarter hour while the module is on, kept across launches so
//! an offline start still shows the last one with its time.
//!
//! [`WeatherService`] is a reducer: everything that decides is synchronous and takes the clock
//! as an argument, so `tests/weather.rs` drives it step by step with a `FakeClock` and scripted
//! outcomes. The only asynchronous parts — the platform's position fix and the provider's
//! requests — happen in the backend loop, between [`WeatherService::plan`] and the matching
//! `complete_*` call.
//!
//! Privacy (`.github/copilot-instructions.md`, "local-first & private"): nothing is requested
//! until `settings.modules.weather.enabled` is true; a device position is rounded to 0.01°
//! (about a kilometre) before it is kept or sent; turning the module off drops the forecast in
//! memory and on disk.

pub mod forecast;
pub mod provider;
pub mod settings;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use muna_core::{Clock, Int53, Settings, Store};
use muna_platform::{GeoPosition, Platform, PlatformError, PlatformResult};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use specta::Type;
use tokio::sync::Notify;

use super::{ModuleBackend, ModuleCtx, Surface};
pub use forecast::{
    CurrentConditions, DAYS_KEPT, DayForecast, Forecast, HOURS_KEPT, HourForecast, WeatherCondition,
};
pub use provider::{FetchError, OpenMeteo, Place, WeatherProvider};
pub use settings::{LocationSetting, Units, WeatherSettings};

pub const ID: &str = "weather";

/// How often the forecast is fetched while the module is on (docs/modules/weather.md).
pub const REFRESH: Duration = Duration::from_mins(15);
/// The first wait after a failed fetch or position fix; doubles per failure up to
/// [`RETRY_MAX`].
pub const RETRY_BASE: Duration = Duration::from_mins(1);
pub const RETRY_MAX: Duration = REFRESH;
/// The `meta` key the last good forecast is kept under.
pub const CACHE_KEY: &str = "weather:forecast";
/// A device position is rounded to this many decimals before anything else sees it: 0.01° is
/// about a kilometre, which is the forecast's own resolution.
pub const COORDINATE_DECIMALS: i32 = 2;

/// How the automatic location stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AutoLocationStatus {
    /// Asking Windows, or about to.
    Resolving,
    /// A position is known.
    Ready,
    /// Windows keeps location from desktop apps; the panel says "Choose a city" and the module
    /// does not ask again until "Try again".
    Denied,
    /// The machine has no location source.
    Unavailable,
    /// The fix failed for another reason; retried with backoff.
    Failed,
}

/// Where the forecast is for, as the panel shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LocationView {
    Auto { status: AutoLocationStatus },
    Manual { place: Place },
}

/// What the UI renders (docs/modules/weather.md).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WeatherSnapshot {
    /// `false` until the user turns the module on; nothing below is populated meanwhile.
    pub enabled: bool,
    pub units: Units,
    pub location: LocationView,
    /// The last good forecast, possibly from a previous launch or an earlier hour.
    pub forecast: Option<Forecast>,
    /// When `forecast` was fetched, Unix milliseconds; the timestamp chip while offline.
    #[specta(type = Option<Int53>)]
    pub fetched_at_ms: Option<i64>,
    /// A request is on the wire.
    pub fetching: bool,
    /// Why the last refresh failed; cleared by the next one that works. The forecast, if any,
    /// stays.
    pub error: Option<FetchError>,
}

/// What the panel can ask for. Settings (on/off, units, place) go through the settings
/// document like every module's.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WeatherCommand {
    /// Fetches now, whatever the schedule says.
    Refresh,
    /// Asks Windows for the position again after a denial, an unavailable source or a failure.
    RetryLocation,
}

/// Why a city search returned nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SearchError {
    #[error("weather is off")]
    Disabled,
    #[error(transparent)]
    Fetch(#[from] FetchError),
}

/// Where the module reports changes; the shell bridges it to a Tauri event.
pub trait WeatherSink: Send + Sync {
    fn changed(&self, snapshot: &WeatherSnapshot);
}

/// One step of asynchronous work the backend loop runs for the service.
#[derive(Debug, Clone, PartialEq)]
pub enum Job {
    /// Ask the platform for the device position.
    Locate,
    /// Fetch the forecast for a point.
    Fetch { latitude: f64, longitude: f64 },
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Auto {
    Unresolved,
    Resolving,
    Ready(f64, f64),
    Denied,
    Unavailable,
    Failed { retry_at_ms: i64 },
}

enum Schedule {
    Now(Job),
    /// Nothing until this wall time (Unix milliseconds).
    At(i64),
    Never,
}

/// The last good forecast as kept in the store.
#[derive(Serialize, Deserialize)]
struct CacheEntry {
    latitude: f64,
    longitude: f64,
    fetched_at_ms: i64,
    forecast: Forecast,
}

struct Inner {
    settings: WeatherSettings,
    /// Bumped when the place or the switch changes, so a result that started under the old
    /// settings is dropped.
    generation: u64,
    in_flight: Option<(Job, u64)>,
    auto: Auto,
    /// Consecutive position fixes that failed (not denials); sets the wait before the next.
    locate_failures: u32,
    forecast: Option<Forecast>,
    forecast_for: Option<(f64, f64)>,
    fetched_at_ms: Option<i64>,
    error: Option<FetchError>,
    /// Consecutive fetches that failed; sets the wait before the next.
    failures: u32,
    /// Wall time the next fetch may run; `None` when one is wanted as soon as a point is known.
    due_at_ms: Option<i64>,
    /// "Refresh" was pressed.
    force: bool,
}

pub struct WeatherService {
    store: Arc<Store>,
    clock: Arc<dyn Clock>,
    provider: Arc<dyn WeatherProvider>,
    inner: Mutex<Inner>,
    sink: Mutex<Option<Arc<dyn WeatherSink>>>,
    /// Wakes the backend loop after a command or a settings change.
    wake: Notify,
}

impl std::fmt::Debug for WeatherService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock();
        f.debug_struct("WeatherService")
            .field("enabled", &inner.settings.enabled)
            .field("auto", &inner.auto)
            .field("in_flight", &inner.in_flight)
            .field("provider", &self.provider.name())
            .finish_non_exhaustive()
    }
}

impl WeatherService {
    #[must_use]
    pub fn new(
        store: Arc<Store>,
        clock: Arc<dyn Clock>,
        provider: Arc<dyn WeatherProvider>,
    ) -> Self {
        Self {
            store,
            clock,
            provider,
            inner: Mutex::new(Inner {
                settings: WeatherSettings::default(),
                generation: 0,
                in_flight: None,
                auto: Auto::Unresolved,
                locate_failures: 0,
                forecast: None,
                forecast_for: None,
                fetched_at_ms: None,
                error: None,
                failures: 0,
                due_at_ms: None,
                force: false,
            }),
            sink: Mutex::new(None),
            wake: Notify::new(),
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn WeatherSink>) {
        *self.sink.lock() = Some(sink);
    }

    #[must_use]
    pub fn settings(&self) -> WeatherSettings {
        self.inner.lock().settings.clone()
    }

    #[must_use]
    pub fn snapshot(&self) -> WeatherSnapshot {
        snapshot_of(&self.inner.lock())
    }

    fn now_ms(&self) -> i64 {
        unix_ms(self.clock.system_time())
    }

    /// Applies `settings.modules.weather` (start-up and every settings change). Turning the
    /// module off forgets the forecast; a new place forgets the old place's forecast and
    /// fetches; new units change nothing here (the UI converts).
    pub fn apply_settings(&self, settings: &Settings) {
        let next = WeatherSettings::from_document(settings);
        let snapshot = {
            let mut inner = self.inner.lock();
            if inner.settings == next {
                return;
            }
            let previous = std::mem::replace(&mut inner.settings, next);
            let switched = previous.enabled != inner.settings.enabled;
            let moved = previous.location != inner.settings.location;
            if switched || moved {
                inner.generation += 1;
                inner.force = false;
                inner.auto = Auto::Unresolved;
                inner.locate_failures = 0;
                inner.error = None;
                inner.failures = 0;
            }
            if !inner.settings.enabled {
                if switched {
                    forget(&mut inner);
                    if let Err(error) = self.store.remove_meta(CACHE_KEY) {
                        tracing::warn!(%error, "weather cache could not be removed");
                    }
                }
            } else if switched || moved {
                match inner.settings.location.clone() {
                    LocationSetting::Manual { place } => {
                        self.adopt_cache(&mut inner, (place.latitude, place.longitude));
                    }
                    LocationSetting::Auto => forget(&mut inner),
                }
            }
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
    }

    /// Runs one command and returns the snapshot after it.
    pub fn command(&self, command: WeatherCommand) -> WeatherSnapshot {
        let snapshot = {
            let mut inner = self.inner.lock();
            match command {
                WeatherCommand::Refresh => {
                    if inner.settings.enabled {
                        inner.force = true;
                    }
                }
                WeatherCommand::RetryLocation => {
                    if inner.settings.enabled
                        && inner.settings.location == LocationSetting::Auto
                        && matches!(
                            inner.auto,
                            Auto::Denied | Auto::Unavailable | Auto::Failed { .. }
                        )
                    {
                        inner.auto = Auto::Unresolved;
                        inner.locate_failures = 0;
                    }
                }
            }
            snapshot_of(&inner)
        };
        tracing::debug!(?command, "weather command");
        self.publish(&snapshot);
        snapshot
    }

    /// What the loop should do now, if anything; marks it in flight. The matching
    /// `complete_*` call must follow before the next `plan`.
    pub fn plan(&self) -> Option<Job> {
        let now = self.now_ms();
        let (job, snapshot) = {
            let mut inner = self.inner.lock();
            let Schedule::Now(job) = schedule(&inner, now) else {
                return None;
            };
            inner.in_flight = Some((job.clone(), inner.generation));
            inner.force = false;
            if job == Job::Locate {
                inner.auto = Auto::Resolving;
            }
            (job, snapshot_of(&inner))
        };
        self.notify(&snapshot);
        Some(job)
    }

    /// How long the loop may sleep: `None` until a command or a settings change wakes it,
    /// zero when a job is due.
    #[must_use]
    pub fn next_wake(&self) -> Option<Duration> {
        let now = self.now_ms();
        match schedule(&self.inner.lock(), now) {
            Schedule::Never => None,
            Schedule::Now(_) => Some(Duration::ZERO),
            Schedule::At(at) => Some(Duration::from_millis(u64::try_from(at - now).unwrap_or(0))),
        }
    }

    /// The outcome of a [`Job::Locate`].
    pub fn complete_locate(&self, result: PlatformResult<GeoPosition>) {
        let now = self.now_ms();
        let snapshot = {
            let mut inner = self.inner.lock();
            let Some((Job::Locate, generation)) = inner.in_flight.take() else {
                tracing::warn!("weather position fix completed without one in flight");
                return;
            };
            if generation == inner.generation {
                match result {
                    Ok(position) => {
                        let point = round_position(&position);
                        tracing::info!("weather position fixed");
                        inner.auto = Auto::Ready(point.0, point.1);
                        inner.locate_failures = 0;
                        self.adopt_cache(&mut inner, point);
                    }
                    Err(PlatformError::AccessDenied(_)) => {
                        tracing::info!("weather position denied; choose a city");
                        inner.auto = Auto::Denied;
                        inner.locate_failures = 0;
                    }
                    Err(PlatformError::Unsupported(_)) => {
                        tracing::info!("weather position unavailable on this machine");
                        inner.auto = Auto::Unavailable;
                        inner.locate_failures = 0;
                    }
                    Err(error) => {
                        inner.locate_failures += 1;
                        let wait = backoff(inner.locate_failures);
                        tracing::warn!(%error, attempts = inner.locate_failures, "weather position fix failed");
                        inner.auto = Auto::Failed {
                            retry_at_ms: now + duration_ms(wait),
                        };
                    }
                }
            } else {
                tracing::debug!("weather position fix outlived its settings; dropped");
            }
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
    }

    /// The outcome of a [`Job::Fetch`].
    pub fn complete_fetch(&self, result: Result<Forecast, FetchError>) {
        let now = self.now_ms();
        let snapshot = {
            let mut inner = self.inner.lock();
            let Some((
                Job::Fetch {
                    latitude,
                    longitude,
                },
                generation,
            )) = inner.in_flight.take()
            else {
                tracing::warn!("weather fetch completed without one in flight");
                return;
            };
            inner.force = false;
            if generation == inner.generation {
                match result {
                    Ok(forecast) => {
                        tracing::info!(hours = forecast.hourly.len(), "weather forecast fetched");
                        inner.forecast = Some(forecast);
                        inner.forecast_for = Some((latitude, longitude));
                        inner.fetched_at_ms = Some(now);
                        inner.error = None;
                        inner.failures = 0;
                        inner.due_at_ms = Some(now + duration_ms(REFRESH));
                        self.persist_cache(&inner);
                    }
                    Err(error) => {
                        inner.failures += 1;
                        inner.error = Some(error);
                        inner.due_at_ms = Some(now + duration_ms(backoff(inner.failures)));
                        tracing::warn!(%error, failures = inner.failures, "weather fetch failed");
                    }
                }
            } else {
                tracing::debug!("weather fetch outlived its settings; dropped");
            }
            snapshot_of(&inner)
        };
        self.publish(&snapshot);
    }

    /// Places matching `query` from the provider; refused while the module is off, so the
    /// settings pane cannot cause a request before the switch is on.
    pub async fn search(&self, query: String) -> Result<Vec<Place>, SearchError> {
        if !self.inner.lock().settings.enabled {
            return Err(SearchError::Disabled);
        }
        Ok(self.provider.search(query).await?)
    }

    /// Wakes the loop so it re-reads the schedule (after a sleep or an unlock, a fetch may be
    /// overdue).
    pub fn wake(&self) {
        self.wake.notify_one();
    }

    /// Takes the stored forecast for `point`, if that is what is stored; otherwise starts
    /// clean for it. A restored forecast keeps its own refresh time, so an old one is fetched
    /// again as soon as the loop runs.
    fn adopt_cache(&self, inner: &mut Inner, point: (f64, f64)) {
        if inner.forecast_for == Some(point) && inner.forecast.is_some() {
            return;
        }
        forget(inner);
        let Some(entry) = self.read_cache() else {
            return;
        };
        if (entry.latitude, entry.longitude) != point {
            return;
        }
        tracing::debug!("weather forecast restored from the cache");
        inner.forecast = Some(entry.forecast);
        inner.forecast_for = Some(point);
        inner.fetched_at_ms = Some(entry.fetched_at_ms);
        inner.due_at_ms = Some(entry.fetched_at_ms + duration_ms(REFRESH));
    }

    fn read_cache(&self) -> Option<CacheEntry> {
        let json = match self.store.get_meta(CACHE_KEY) {
            Ok(Some(json)) => json,
            Ok(None) => return None,
            Err(error) => {
                tracing::warn!(%error, "weather cache unreadable");
                return None;
            }
        };
        serde_json::from_str(&json)
            .map_err(|error| tracing::warn!(%error, "weather cache malformed; ignored"))
            .ok()
    }

    fn persist_cache(&self, inner: &Inner) {
        let (Some(forecast), Some((latitude, longitude)), Some(fetched_at_ms)) =
            (&inner.forecast, inner.forecast_for, inner.fetched_at_ms)
        else {
            return;
        };
        let entry = CacheEntry {
            latitude,
            longitude,
            fetched_at_ms,
            forecast: forecast.clone(),
        };
        match serde_json::to_string(&entry) {
            Ok(json) => {
                if let Err(error) = self.store.set_meta(CACHE_KEY, &json) {
                    tracing::warn!(%error, "weather cache could not be written");
                }
            }
            Err(error) => tracing::warn!(%error, "weather cache could not be serialised"),
        }
    }

    fn notify(&self, snapshot: &WeatherSnapshot) {
        let sink = self.sink.lock().clone();
        if let Some(sink) = sink {
            sink.changed(snapshot);
        }
    }

    /// Tells the sink and wakes the loop.
    fn publish(&self, snapshot: &WeatherSnapshot) {
        self.notify(snapshot);
        self.wake.notify_one();
    }
}

/// Drops the forecast and its schedule; the settings and the location state stay.
fn forget(inner: &mut Inner) {
    inner.forecast = None;
    inner.forecast_for = None;
    inner.fetched_at_ms = None;
    inner.due_at_ms = None;
}

fn schedule(inner: &Inner, now: i64) -> Schedule {
    if !inner.settings.enabled || inner.in_flight.is_some() {
        return Schedule::Never;
    }
    let (latitude, longitude) = match &inner.settings.location {
        LocationSetting::Manual { place } => (place.latitude, place.longitude),
        LocationSetting::Auto => match inner.auto {
            Auto::Ready(latitude, longitude) => (latitude, longitude),
            Auto::Unresolved => return Schedule::Now(Job::Locate),
            Auto::Failed { retry_at_ms, .. } => {
                return if retry_at_ms <= now {
                    Schedule::Now(Job::Locate)
                } else {
                    Schedule::At(retry_at_ms)
                };
            }
            Auto::Resolving | Auto::Denied | Auto::Unavailable => return Schedule::Never,
        },
    };
    let job = Job::Fetch {
        latitude,
        longitude,
    };
    if inner.force {
        return Schedule::Now(job);
    }
    match inner.due_at_ms {
        Some(due) if due > now => Schedule::At(due),
        _ => Schedule::Now(job),
    }
}

fn snapshot_of(inner: &Inner) -> WeatherSnapshot {
    WeatherSnapshot {
        enabled: inner.settings.enabled,
        units: inner.settings.units,
        location: match &inner.settings.location {
            LocationSetting::Manual { place } => LocationView::Manual {
                place: place.clone(),
            },
            LocationSetting::Auto => LocationView::Auto {
                status: match inner.auto {
                    Auto::Unresolved | Auto::Resolving => AutoLocationStatus::Resolving,
                    Auto::Ready(..) => AutoLocationStatus::Ready,
                    Auto::Denied => AutoLocationStatus::Denied,
                    Auto::Unavailable => AutoLocationStatus::Unavailable,
                    Auto::Failed { .. } => AutoLocationStatus::Failed,
                },
            },
        },
        forecast: inner.forecast.clone(),
        fetched_at_ms: inner.fetched_at_ms,
        fetching: matches!(inner.in_flight, Some((Job::Fetch { .. }, _))),
        error: inner.error,
    }
}

/// The wait after the `attempt`th consecutive failure: 1, 2, 4, 8 minutes, then the refresh
/// period.
#[must_use]
pub fn backoff(attempt: u32) -> Duration {
    let doublings = attempt.saturating_sub(1).min(8);
    (RETRY_BASE * 2u32.pow(doublings)).min(RETRY_MAX)
}

/// A device position rounded to [`COORDINATE_DECIMALS`].
#[must_use]
pub fn round_position(position: &GeoPosition) -> (f64, f64) {
    (
        round_coordinate(position.latitude),
        round_coordinate(position.longitude),
    )
}

fn round_coordinate(value: f64) -> f64 {
    let scale = 10f64.powi(COORDINATE_DECIMALS);
    (value * scale).round() / scale
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

/// The backend: runs the refresh loop and re-checks the schedule after an unlock.
#[derive(Debug, Clone)]
pub struct WeatherModule(pub Arc<WeatherService>);

impl ModuleBackend for WeatherModule {
    fn id(&self) -> &'static str {
        ID
    }

    fn capabilities(&self) -> &'static [Surface] {
        &[Surface::Panel, Surface::Widget]
    }

    fn start(&self, ctx: ModuleCtx) -> anyhow::Result<()> {
        let service = Arc::clone(&self.0);
        let platform: Arc<dyn Platform> = Arc::clone(&ctx.platform);
        tauri::async_runtime::spawn(async move {
            loop {
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
                let Some(job) = service.plan() else {
                    continue;
                };
                match job {
                    Job::Locate => {
                        let platform = Arc::clone(&platform);
                        let result = tauri::async_runtime::spawn_blocking(move || {
                            platform.location().position()
                        })
                        .await
                        .unwrap_or_else(|error| {
                            tracing::warn!(%error, "weather position task failed");
                            Err(PlatformError::Os {
                                api: "spawn_blocking",
                                code: 0,
                            })
                        });
                        service.complete_locate(result);
                    }
                    Job::Fetch {
                        latitude,
                        longitude,
                    } => {
                        let result = service.provider.forecast(latitude, longitude).await;
                        service.complete_fetch(result);
                    }
                }
            }
        });
        let service = Arc::clone(&self.0);
        let mut events = ctx.platform.subscribe();
        tauri::async_runtime::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(muna_platform::PlatformEvent::SessionLockChanged { locked: false }) => {
                        service.wake();
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!(skipped, "weather events lagged");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        Ok(())
    }
}
