//! The `weather` module against `FakePlatform` and a scripted provider (docs/modules/weather.md
//! acceptance criteria, docs/build-plan/m3-daily-modules.md E4). Integration tests because the
//! `muna` lib cannot host unit tests (Common Controls manifest on Tauri-linked tests).
//!
//! The service is a reducer: the tests call `plan` and hand the outcome to `complete_*` in
//! place of the backend loop, so every branch runs without a network or a runtime.

use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use muna_core::{Clock, FakeClock, Hub, Settings, Store};
use muna_lib::modules::weather::provider::{
    BoxFuture, forecast_url, parse_forecast, parse_places, search_url,
};
use muna_lib::modules::weather::{
    AutoLocationStatus, CACHE_KEY, DAYS_KEPT, FetchError, Forecast, HOURS_KEPT, ID, Job,
    LocationSetting, LocationView, Place, REFRESH, RETRY_BASE, RETRY_MAX, SearchError, Units,
    WeatherCommand, WeatherCondition, WeatherProvider, WeatherService, WeatherSettings,
    WeatherSink, WeatherSnapshot, backoff, round_position,
};
use muna_lib::modules::{ModuleServices, Surface, backends};
use muna_platform::{FakePlatform, GeoPosition, Platform, PlatformError};
use parking_lot::Mutex;

const FORECAST_JSON: &str = include_str!("fixtures/open-meteo-forecast.json");
const PLACES_JSON: &str = include_str!("fixtures/open-meteo-search.json");

const BERLIN: Place = Place {
    name: String::new(),
    region: None,
    country: None,
    latitude: 52.52,
    longitude: 13.41,
};

fn berlin() -> Place {
    Place {
        name: "Berlin".into(),
        region: Some("Land Berlin".into()),
        country: Some("Germany".into()),
        ..BERLIN
    }
}

/// A provider that never makes a request; `search` answers from the fixture.
struct StubProvider {
    forecasts: Mutex<Vec<Result<Forecast, FetchError>>>,
    searches: Mutex<Vec<String>>,
}

impl StubProvider {
    fn new() -> Self {
        Self {
            forecasts: Mutex::new(Vec::new()),
            searches: Mutex::new(Vec::new()),
        }
    }
}

impl WeatherProvider for StubProvider {
    fn forecast(
        &self,
        _latitude: f64,
        _longitude: f64,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>> {
        let result = self
            .forecasts
            .lock()
            .pop()
            .unwrap_or(Err(FetchError::Offline));
        Box::pin(async move { result })
    }

    fn search(&self, query: String) -> BoxFuture<'_, Result<Vec<Place>, FetchError>> {
        self.searches.lock().push(query);
        Box::pin(async move { parse_places(PLACES_JSON) })
    }

    fn name(&self) -> &'static str {
        "stub"
    }
}

#[derive(Default)]
struct Recorder {
    snapshots: Mutex<Vec<WeatherSnapshot>>,
}

impl WeatherSink for Recorder {
    fn changed(&self, snapshot: &WeatherSnapshot) {
        self.snapshots.lock().push(snapshot.clone());
    }
}

struct Rig {
    clock: Arc<FakeClock>,
    platform: Arc<FakePlatform>,
    store: Arc<Store>,
    provider: Arc<StubProvider>,
    service: Arc<WeatherService>,
    recorder: Arc<Recorder>,
}

impl Rig {
    fn new() -> Self {
        Self::with_store(Arc::new(Store::open_in_memory().expect("store")))
    }

    /// A fresh service over an existing store: "the next launch".
    fn with_store(store: Arc<Store>) -> Self {
        let clock = Arc::new(FakeClock::at(
            UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        ));
        let platform = Arc::new(FakePlatform::new());
        let provider = Arc::new(StubProvider::new());
        let service = Arc::new(WeatherService::new(
            Arc::clone(&store),
            Arc::clone(&clock) as Arc<dyn Clock>,
            Arc::clone(&provider) as Arc<dyn WeatherProvider>,
        ));
        let recorder = Arc::new(Recorder::default());
        service.set_sink(Arc::clone(&recorder) as Arc<dyn WeatherSink>);
        Self {
            clock,
            platform,
            store,
            provider,
            service,
            recorder,
        }
    }

    fn apply(&self, settings: &WeatherSettings) {
        let mut document = Settings::default();
        settings.write(&mut document).expect("settings serialise");
        self.service.apply_settings(&document);
    }

    fn enable(&self, location: LocationSetting) {
        self.apply(&WeatherSettings {
            enabled: true,
            units: Units::Metric,
            location,
        });
    }

    fn now_ms(&self) -> i64 {
        i64::try_from(
            self.clock
                .system_time()
                .duration_since(UNIX_EPOCH)
                .expect("after the epoch")
                .as_millis(),
        )
        .expect("fits")
    }

    /// What the backend loop does for a `Locate`: ask the fake platform.
    fn locate(&self) {
        assert_eq!(
            self.service.plan(),
            Some(Job::Locate),
            "a position fix is due"
        );
        self.service
            .complete_locate(self.platform.location().position());
    }

    /// What the backend loop does for a `Fetch`: ask the provider.
    fn fetch(&self, result: Result<Forecast, FetchError>) -> Job {
        let job = self.service.plan().expect("a fetch is due");
        assert!(
            matches!(job, Job::Fetch { .. }),
            "expected a fetch, got {job:?}"
        );
        self.service.complete_fetch(result);
        job
    }

    fn snapshot(&self) -> WeatherSnapshot {
        self.service.snapshot()
    }

    fn auto_status(&self) -> AutoLocationStatus {
        match self.snapshot().location {
            LocationView::Auto { status } => status,
            LocationView::Manual { .. } => panic!("expected an automatic location"),
        }
    }
}

fn good_forecast() -> Forecast {
    parse_forecast(FORECAST_JSON).expect("fixture parses")
}

// --- settings ------------------------------------------------------------------------------

#[test]
fn settings_default_to_off_metric_and_auto() {
    let settings = WeatherSettings::from_document(&Settings::default());
    assert_eq!(settings, WeatherSettings::default());
    assert!(!settings.enabled, "network is opt-in");
    assert_eq!(settings.units, Units::Metric);
    assert_eq!(settings.location, LocationSetting::Auto);
}

#[test]
fn settings_round_trip_through_the_document() {
    let settings = WeatherSettings {
        enabled: true,
        units: Units::Imperial,
        location: LocationSetting::Manual { place: berlin() },
    };
    let mut document = Settings::default();
    settings.write(&mut document).unwrap();
    let json = serde_json::to_value(&document.modules[ID]).unwrap();
    assert_eq!(json["units"], "imperial");
    assert_eq!(json["location"]["kind"], "manual");
    assert_eq!(json["location"]["place"]["name"], "Berlin");
    assert_eq!(WeatherSettings::from_document(&document), settings);
}

#[test]
fn settings_tolerate_junk_and_unknown_keys() {
    let mut document = Settings::default();
    document
        .modules
        .insert(ID.into(), serde_json::json!("junk"));
    assert_eq!(
        WeatherSettings::from_document(&document),
        WeatherSettings::default()
    );

    document.modules.insert(
        ID.into(),
        serde_json::json!({ "enabled": true, "future": 1, "location": { "kind": "auto" } }),
    );
    let settings = WeatherSettings::from_document(&document);
    assert!(settings.enabled);
    assert_eq!(settings.units, Units::Metric);
}

#[test]
fn a_place_off_the_globe_falls_back_to_the_device_location() {
    let mut document = Settings::default();
    document.modules.insert(
        ID.into(),
        serde_json::json!({
            "enabled": true,
            "location": {
                "kind": "manual",
                "place": { "name": "Nowhere", "region": null, "country": null,
                           "latitude": 91.0, "longitude": 13.4 }
            }
        }),
    );
    let settings = WeatherSettings::from_document(&document);
    assert!(settings.enabled, "the rest of the namespace still counts");
    assert_eq!(settings.location, LocationSetting::Auto);
    assert!(
        !Place {
            latitude: 91.0,
            ..berlin()
        }
        .is_valid()
    );
    assert!(berlin().is_valid());
}

// --- switch --------------------------------------------------------------------------------

#[test]
fn off_by_default_plans_nothing_and_never_asks_for_the_position() {
    let rig = Rig::new();
    rig.apply(&WeatherSettings::default());
    assert_eq!(rig.service.plan(), None);
    assert_eq!(rig.service.next_wake(), None, "the loop sleeps until woken");
    assert_eq!(rig.platform.location_requests(), 0);
    let snapshot = rig.snapshot();
    assert!(!snapshot.enabled);
    assert!(snapshot.forecast.is_none());
    assert!(!snapshot.fetching);
}

#[test]
fn enabling_with_auto_location_locates_then_fetches() {
    let rig = Rig::new();
    rig.platform.set_location(Some(GeoPosition {
        latitude: 52.5200,
        longitude: 13.4050,
        accuracy_m: Some(500.0),
    }));
    rig.enable(LocationSetting::Auto);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    assert_eq!(rig.auto_status(), AutoLocationStatus::Resolving);

    rig.locate();
    assert_eq!(rig.platform.location_requests(), 1);
    assert_eq!(rig.auto_status(), AutoLocationStatus::Ready);

    let job = rig.fetch(Ok(good_forecast()));
    assert_eq!(
        job,
        Job::Fetch {
            latitude: 52.52,
            longitude: 13.41
        },
        "the device position is rounded to 0.01° before it is used"
    );
    let snapshot = rig.snapshot();
    assert!(snapshot.forecast.is_some());
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms()));
    assert_eq!(snapshot.error, None);
    assert!(!snapshot.fetching);
    assert_eq!(
        rig.service.next_wake(),
        Some(REFRESH),
        "next refresh in a quarter hour"
    );
    assert_eq!(rig.service.plan(), None, "nothing due before then");
}

#[test]
fn a_manual_place_skips_the_position_fix() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    assert_eq!(rig.platform.location_requests(), 0);
    let job = rig.fetch(Ok(good_forecast()));
    assert_eq!(
        job,
        Job::Fetch {
            latitude: 52.52,
            longitude: 13.41
        }
    );
    assert_eq!(rig.platform.location_requests(), 0);
    assert_eq!(
        rig.snapshot().location,
        LocationView::Manual { place: berlin() }
    );
}

#[test]
fn a_denied_position_shows_choose_a_city_and_is_not_asked_again() {
    let rig = Rig::new();
    rig.platform.set_location_denied(true);
    rig.enable(LocationSetting::Auto);
    rig.locate();
    assert_eq!(rig.auto_status(), AutoLocationStatus::Denied);
    assert_eq!(rig.platform.location_requests(), 1);

    for _ in 0..5 {
        rig.clock.advance(Duration::from_hours(1));
        assert_eq!(rig.service.plan(), None, "no repeated prompts");
        assert_eq!(rig.service.next_wake(), None);
    }
    assert_eq!(rig.platform.location_requests(), 1);
    assert!(rig.snapshot().forecast.is_none());

    // "Try again" is the only way back.
    rig.platform.set_location_denied(false);
    rig.platform.set_location(Some(GeoPosition {
        latitude: 48.8566,
        longitude: 2.3522,
        accuracy_m: None,
    }));
    rig.service.command(WeatherCommand::RetryLocation);
    assert_eq!(rig.auto_status(), AutoLocationStatus::Resolving);
    rig.locate();
    assert_eq!(rig.platform.location_requests(), 2);
    assert_eq!(rig.auto_status(), AutoLocationStatus::Ready);
    assert_eq!(
        rig.service.plan(),
        Some(Job::Fetch {
            latitude: 48.86,
            longitude: 2.35
        })
    );
}

#[test]
fn an_unavailable_position_source_is_reported_once() {
    let rig = Rig::new();
    rig.platform.set_location(None);
    rig.enable(LocationSetting::Auto);
    rig.locate();
    assert_eq!(rig.auto_status(), AutoLocationStatus::Unavailable);
    assert_eq!(rig.service.plan(), None);
    assert_eq!(rig.platform.location_requests(), 1);
}

#[test]
fn a_failed_position_fix_is_retried_with_backoff() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Auto);
    assert_eq!(rig.service.plan(), Some(Job::Locate));
    rig.service.complete_locate(Err(PlatformError::Os {
        api: "GetGeopositionAsync",
        code: 0x8000_4005,
    }));
    assert_eq!(rig.auto_status(), AutoLocationStatus::Failed);
    assert_eq!(rig.service.next_wake(), Some(RETRY_BASE));
    assert_eq!(rig.service.plan(), None);

    rig.clock.advance(RETRY_BASE);
    assert_eq!(rig.service.plan(), Some(Job::Locate));
    rig.service.complete_locate(Err(PlatformError::Os {
        api: "GetGeopositionAsync",
        code: 0x8000_4005,
    }));
    assert_eq!(rig.service.next_wake(), Some(RETRY_BASE * 2));
}

#[test]
fn retry_location_does_nothing_while_a_position_is_known_or_the_place_is_manual() {
    let rig = Rig::new();
    rig.platform.set_location(Some(GeoPosition {
        latitude: 1.0,
        longitude: 1.0,
        accuracy_m: None,
    }));
    rig.enable(LocationSetting::Auto);
    rig.locate();
    rig.service.command(WeatherCommand::RetryLocation);
    assert_eq!(rig.auto_status(), AutoLocationStatus::Ready);
    assert_eq!(rig.platform.location_requests(), 1);

    rig.enable(LocationSetting::Manual { place: berlin() });
    rig.service.command(WeatherCommand::RetryLocation);
    assert!(matches!(rig.service.plan(), Some(Job::Fetch { .. })));
    assert_eq!(rig.platform.location_requests(), 1);
}

// --- refresh -------------------------------------------------------------------------------

#[test]
fn a_failed_fetch_keeps_the_last_forecast_and_backs_off() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    rig.fetch(Ok(good_forecast()));
    let fetched_at = rig.snapshot().fetched_at_ms;

    rig.clock.advance(REFRESH);
    rig.fetch(Err(FetchError::Offline));
    let snapshot = rig.snapshot();
    assert!(
        snapshot.forecast.is_some(),
        "offline keeps the last forecast"
    );
    assert_eq!(snapshot.fetched_at_ms, fetched_at, "with its own time");
    assert_eq!(snapshot.error, Some(FetchError::Offline));
    assert_eq!(rig.service.next_wake(), Some(RETRY_BASE));

    let mut expected = RETRY_BASE;
    for _ in 0..6 {
        rig.clock.advance(expected);
        rig.fetch(Err(FetchError::Provider));
        expected = (expected * 2).min(RETRY_MAX);
        assert_eq!(rig.service.next_wake(), Some(expected));
    }
    assert_eq!(
        expected, RETRY_MAX,
        "the wait tops out at the refresh period"
    );

    rig.clock.advance(expected);
    rig.fetch(Ok(good_forecast()));
    let snapshot = rig.snapshot();
    assert_eq!(snapshot.error, None, "a good fetch clears the error");
    assert_eq!(snapshot.fetched_at_ms, Some(rig.now_ms()));
    assert_eq!(rig.service.next_wake(), Some(REFRESH));
}

#[test]
fn refresh_fetches_now_and_reports_fetching_while_in_flight() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    rig.fetch(Ok(good_forecast()));
    assert_eq!(rig.service.plan(), None);

    rig.service.command(WeatherCommand::Refresh);
    assert_eq!(rig.service.next_wake(), Some(Duration::ZERO));
    let job = rig.service.plan();
    assert!(matches!(job, Some(Job::Fetch { .. })));
    assert!(rig.snapshot().fetching);
    assert_eq!(rig.service.plan(), None, "one request at a time");
    assert_eq!(
        rig.service.next_wake(),
        None,
        "the loop waits for the result"
    );
    rig.service.complete_fetch(Ok(good_forecast()));
    assert!(!rig.snapshot().fetching);
    assert_eq!(rig.service.next_wake(), Some(REFRESH));
}

#[test]
fn refresh_while_off_does_nothing() {
    let rig = Rig::new();
    rig.apply(&WeatherSettings::default());
    rig.service.command(WeatherCommand::Refresh);
    assert_eq!(rig.service.plan(), None);
}

#[test]
fn a_result_from_before_a_settings_change_is_dropped() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    let job = rig.service.plan();
    assert!(matches!(job, Some(Job::Fetch { .. })));

    let paris = Place {
        name: "Paris".into(),
        region: None,
        country: Some("France".into()),
        latitude: 48.86,
        longitude: 2.35,
    };
    rig.enable(LocationSetting::Manual { place: paris });
    rig.service.complete_fetch(Ok(good_forecast()));
    let snapshot = rig.snapshot();
    assert!(
        snapshot.forecast.is_none(),
        "Berlin's forecast is not Paris's"
    );
    assert!(!snapshot.fetching);
    assert_eq!(
        rig.service.plan(),
        Some(Job::Fetch {
            latitude: 48.86,
            longitude: 2.35
        })
    );
}

// --- cache ---------------------------------------------------------------------------------

#[test]
fn the_last_forecast_survives_a_relaunch_for_the_same_place() {
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let first = Rig::with_store(Arc::clone(&store));
    first.enable(LocationSetting::Manual { place: berlin() });
    first.fetch(Ok(good_forecast()));
    let fetched_at = first.snapshot().fetched_at_ms;
    assert!(store.get_meta(CACHE_KEY).unwrap().is_some());

    let second = Rig::with_store(Arc::clone(&store));
    second.clock.advance(Duration::from_hours(3));
    second.enable(LocationSetting::Manual { place: berlin() });
    let snapshot = second.snapshot();
    assert!(
        snapshot.forecast.is_some(),
        "offline start shows the last forecast"
    );
    assert_eq!(
        snapshot.fetched_at_ms, fetched_at,
        "with the time it was fetched"
    );
    assert_eq!(
        second.service.next_wake(),
        Some(Duration::ZERO),
        "and fetches again straight away because it is old"
    );
}

#[test]
fn the_cache_is_ignored_for_another_place() {
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let first = Rig::with_store(Arc::clone(&store));
    first.enable(LocationSetting::Manual { place: berlin() });
    first.fetch(Ok(good_forecast()));

    let second = Rig::with_store(Arc::clone(&store));
    second.platform.set_location(Some(GeoPosition {
        latitude: 48.86,
        longitude: 2.35,
        accuracy_m: None,
    }));
    second.enable(LocationSetting::Auto);
    second.locate();
    assert!(second.snapshot().forecast.is_none());
}

#[test]
fn the_cache_is_restored_for_the_same_device_position() {
    let store = Arc::new(Store::open_in_memory().expect("store"));
    let position = GeoPosition {
        latitude: 52.5234,
        longitude: 13.4123,
        accuracy_m: Some(100.0),
    };
    let first = Rig::with_store(Arc::clone(&store));
    first.platform.set_location(Some(position));
    first.enable(LocationSetting::Auto);
    first.locate();
    first.fetch(Ok(good_forecast()));

    let second = Rig::with_store(Arc::clone(&store));
    second.platform.set_location(Some(GeoPosition {
        latitude: 52.5199,
        longitude: 13.4087,
        accuracy_m: Some(2000.0),
    }));
    second.enable(LocationSetting::Auto);
    second.locate();
    assert!(
        second.snapshot().forecast.is_some(),
        "positions within the same 0.01° cell share the forecast"
    );
}

#[test]
fn turning_the_module_off_forgets_the_forecast_here_and_on_disk() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    rig.fetch(Ok(good_forecast()));
    assert!(rig.store.get_meta(CACHE_KEY).unwrap().is_some());

    rig.apply(&WeatherSettings::default());
    let snapshot = rig.snapshot();
    assert!(!snapshot.enabled);
    assert!(snapshot.forecast.is_none());
    assert_eq!(snapshot.fetched_at_ms, None);
    assert_eq!(rig.store.get_meta(CACHE_KEY).unwrap(), None);
    assert_eq!(rig.service.plan(), None);
}

#[test]
fn a_malformed_cache_is_ignored() {
    let store = Arc::new(Store::open_in_memory().expect("store"));
    store.set_meta(CACHE_KEY, "{ not json").unwrap();
    let rig = Rig::with_store(store);
    rig.enable(LocationSetting::Manual { place: berlin() });
    assert!(rig.snapshot().forecast.is_none());
    assert!(matches!(rig.service.plan(), Some(Job::Fetch { .. })));
}

// --- settings changes ----------------------------------------------------------------------

#[test]
fn changing_units_re_emits_without_refetching() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    rig.fetch(Ok(good_forecast()));
    let before = rig.recorder.snapshots.lock().len();

    rig.apply(&WeatherSettings {
        enabled: true,
        units: Units::Imperial,
        location: LocationSetting::Manual { place: berlin() },
    });
    let snapshots = rig.recorder.snapshots.lock();
    assert_eq!(snapshots.len(), before + 1);
    let last = snapshots.last().unwrap();
    assert_eq!(last.units, Units::Imperial);
    assert!(
        last.forecast.is_some(),
        "the forecast stays; the UI converts"
    );
    drop(snapshots);
    assert_eq!(rig.service.plan(), None);
}

#[test]
fn unchanged_settings_are_a_no_op() {
    let rig = Rig::new();
    rig.enable(LocationSetting::Manual { place: berlin() });
    let before = rig.recorder.snapshots.lock().len();
    rig.enable(LocationSetting::Manual { place: berlin() });
    assert_eq!(rig.recorder.snapshots.lock().len(), before);
}

#[test]
fn switching_from_auto_to_a_city_forgets_the_device_forecast() {
    let rig = Rig::new();
    rig.platform.set_location(Some(GeoPosition {
        latitude: 1.0,
        longitude: 1.0,
        accuracy_m: None,
    }));
    rig.enable(LocationSetting::Auto);
    rig.locate();
    rig.fetch(Ok(good_forecast()));

    rig.enable(LocationSetting::Manual { place: berlin() });
    assert!(rig.snapshot().forecast.is_none());
    assert_eq!(
        rig.service.plan(),
        Some(Job::Fetch {
            latitude: 52.52,
            longitude: 13.41
        })
    );
}

// --- search --------------------------------------------------------------------------------

#[test]
fn search_is_refused_while_off_and_answers_when_on() {
    let rig = Rig::new();
    rig.apply(&WeatherSettings::default());
    let result = futures_lite_block_on(rig.service.search("Berlin".into()));
    assert_eq!(result, Err(SearchError::Disabled));
    assert!(
        rig.provider.searches.lock().is_empty(),
        "no request while off"
    );

    rig.enable(LocationSetting::Auto);
    let places = futures_lite_block_on(rig.service.search("Berlin".into())).unwrap();
    assert_eq!(places.len(), 2);
    assert_eq!(places[0].name, "Berlin");
    assert_eq!(places[0].region.as_deref(), Some("Land Berlin"));
    assert_eq!(places[0].country.as_deref(), Some("Germany"));
    assert_eq!(rig.provider.searches.lock().as_slice(), ["Berlin"]);
}

/// A tiny executor for futures that are already complete (the stub's are).
fn futures_lite_block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    use std::pin::pin;
    use std::task::{Context, Poll, Waker};
    let mut context = Context::from_waker(Waker::noop());
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(value) = future.as_mut().poll(&mut context) {
            return value;
        }
    }
}

// --- provider parsing ----------------------------------------------------------------------

#[test]
fn parse_forecast_reads_the_fixture_and_trims_past_hours() {
    let forecast = good_forecast();
    assert_eq!(forecast.timezone, "Europe/Berlin");
    let current = &forecast.current;
    assert_eq!(current.time, "2024-05-14T10:15");
    assert_eq!(current.condition, WeatherCondition::PartlyCloudy);
    assert!(current.is_day);
    assert!((current.temperature_c - 18.4).abs() < f64::EPSILON);
    assert!((current.apparent_temperature_c - 17.1).abs() < f64::EPSILON);
    assert_eq!(current.humidity_percent, 55);
    assert!((current.wind_kmh - 12.3).abs() < f64::EPSILON);
    assert!((current.pressure_hpa - 1013.2).abs() < f64::EPSILON);
    assert_eq!(
        current.uv_index,
        Some(4.1),
        "the UV index of the current hour (10:00)"
    );

    assert_eq!(
        forecast.hourly.first().map(|hour| hour.time.as_str()),
        Some("2024-05-14T10:00"),
        "hours before the current one are dropped"
    );
    assert!(forecast.hourly.len() <= HOURS_KEPT);
    assert_eq!(
        forecast.hourly.len(),
        3,
        "the fixture has three hours from 10:00"
    );
    assert_eq!(
        forecast.hourly[1].precipitation_percent, None,
        "a null cell stays empty"
    );
    assert_eq!(forecast.hourly[2].condition, WeatherCondition::Rain);

    assert!(forecast.daily.len() <= DAYS_KEPT);
    assert_eq!(forecast.daily.len(), 2);
    let today = &forecast.daily[0];
    assert_eq!(today.date, "2024-05-14");
    assert_eq!(today.condition, WeatherCondition::Showers);
    assert!((today.high_c - 21.0).abs() < f64::EPSILON);
    assert!((today.low_c - 9.5).abs() < f64::EPSILON);
    assert_eq!(today.sunrise, "2024-05-14T05:12");
    assert_eq!(today.sunset, "2024-05-14T20:55");
    assert_eq!(today.precipitation_percent, Some(60));
    assert_eq!(
        forecast.daily.len(),
        2,
        "a day whose temperature is missing is skipped rather than shown blank"
    );
}

#[test]
fn parse_forecast_rejects_a_body_that_is_not_a_forecast() {
    assert_eq!(parse_forecast("{}").unwrap_err(), FetchError::Provider);
    assert_eq!(
        parse_forecast(r#"{"error":true,"reason":"Latitude must be in range"}"#).unwrap_err(),
        FetchError::Provider
    );
    assert_eq!(parse_forecast("<html>").unwrap_err(), FetchError::Provider);
}

#[test]
fn parse_places_reads_results_and_tolerates_none() {
    let places = parse_places(PLACES_JSON).unwrap();
    assert_eq!(places.len(), 2);
    assert_eq!(places[1].name, "Berlin");
    assert_eq!(places[1].region.as_deref(), Some("Connecticut"));
    assert!((places[1].latitude - 41.62).abs() < 0.01);

    assert_eq!(
        parse_places(r#"{"generationtime_ms":0.5}"#).unwrap(),
        vec![]
    );
    assert_eq!(parse_places("nope").unwrap_err(), FetchError::Provider);
}

#[test]
fn urls_are_built_as_the_provider_documents() {
    let url = forecast_url(52.52, 13.41);
    assert!(
        url.starts_with(
            "https://api.open-meteo.com/v1/forecast?latitude=52.5200&longitude=13.4100&"
        )
    );
    assert!(url.contains("&current=temperature_2m,"));
    assert!(url.contains("&hourly=temperature_2m,"));
    assert!(url.contains("&daily=weather_code,"));
    assert!(url.ends_with("&timezone=auto&forecast_days=7"));

    assert_eq!(search_url(""), None);
    assert_eq!(search_url("   "), None);
    let search = search_url("  São Paulo ").unwrap();
    assert!(
        search.starts_with("https://geocoding-api.open-meteo.com/v1/search?name=S%C3%A3o+Paulo&")
    );
    assert!(search.contains("count=8"));
    assert!(search.ends_with("&language=en&format=json"));
}

#[test]
fn weather_codes_map_to_conditions() {
    let table = [
        (0, WeatherCondition::Clear),
        (1, WeatherCondition::MainlyClear),
        (2, WeatherCondition::PartlyCloudy),
        (3, WeatherCondition::Overcast),
        (45, WeatherCondition::Fog),
        (48, WeatherCondition::Fog),
        (51, WeatherCondition::Drizzle),
        (57, WeatherCondition::Drizzle),
        (61, WeatherCondition::Rain),
        (67, WeatherCondition::Rain),
        (71, WeatherCondition::Snow),
        (77, WeatherCondition::Snow),
        (80, WeatherCondition::Showers),
        (82, WeatherCondition::Showers),
        (85, WeatherCondition::SnowShowers),
        (86, WeatherCondition::SnowShowers),
        (95, WeatherCondition::Thunderstorm),
        (99, WeatherCondition::Thunderstorm),
        (4, WeatherCondition::Unknown),
        (100, WeatherCondition::Unknown),
    ];
    for (code, expected) in table {
        assert_eq!(WeatherCondition::from_code(code), expected, "code {code}");
    }
}

#[test]
fn backoff_doubles_from_a_minute_to_the_refresh_period() {
    assert_eq!(backoff(0), RETRY_BASE);
    assert_eq!(backoff(1), RETRY_BASE);
    assert_eq!(backoff(2), RETRY_BASE * 2);
    assert_eq!(backoff(4), RETRY_BASE * 8);
    assert_eq!(backoff(5), RETRY_MAX);
    assert_eq!(backoff(50), RETRY_MAX);
}

#[test]
fn positions_round_to_a_hundredth_of_a_degree() {
    let (latitude, longitude) = round_position(&GeoPosition {
        latitude: 52.5234,
        longitude: -0.1275,
        accuracy_m: None,
    });
    assert!((latitude - 52.52).abs() < f64::EPSILON);
    assert!((longitude + 0.13).abs() < f64::EPSILON);
}

// --- registry ------------------------------------------------------------------------------

#[test]
fn the_backend_is_registered_with_panel_and_widget() {
    let clock = Arc::new(FakeClock::new());
    let platform: Arc<dyn Platform> = Arc::new(FakePlatform::new());
    let hub = Arc::new(Hub::new(Arc::clone(&clock) as Arc<dyn Clock>));
    let store = Arc::new(Store::open_in_memory().expect("store"));
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
        .expect("weather is registered");
    assert_eq!(backend.capabilities(), &[Surface::Panel, Surface::Widget]);
    assert!(
        !services.weather.settings().enabled,
        "off until the user turns it on"
    );
}
