//! The forecast source (docs/modules/weather.md "Data"): Open-Meteo, no key, one adapter
//! behind a trait so the module can be tested without a network and another provider can be
//! slotted in later (docs/08-risk-register.md R11).
//!
//! Nothing here runs unless the user turned the module on: the service only calls the provider
//! from its refresh loop and the city search, both of which check `settings.modules.weather.
//! enabled` first. Requests carry coordinates and nothing else.

use std::future::Future;
use std::pin::Pin;
use std::sync::OnceLock;
use std::time::Duration;

use muna_core::Finite;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::forecast::{CurrentConditions, DayForecast, Forecast, HourForecast, WeatherCondition};

/// Where forecasts come from; the host is the whole allow-list.
pub const FORECAST_ENDPOINT: &str = "https://api.open-meteo.com/v1/forecast";
/// Where "Choose a city" searches.
pub const GEOCODING_ENDPOINT: &str = "https://geocoding-api.open-meteo.com/v1/search";
/// How long one request may take before it counts as offline.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
/// How many places one search returns at most.
pub const SEARCH_RESULTS: usize = 8;

const USER_AGENT: &str = concat!(
    "Muna/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/miklol/Muna)"
);

/// Why a refresh or a search did not produce a result. Never carries what the provider said:
/// the UI has two sentences, one per case.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum FetchError {
    /// No connection, a DNS failure or a timeout: the last forecast stands with its time.
    #[error("the weather service could not be reached")]
    Offline,
    /// The service answered, but not with a forecast (an error status or a shape this build
    /// does not understand).
    #[error("the weather service answered with something unexpected")]
    Provider,
}

/// A place the user can pick (docs/modules/weather.md "manual city"), as the geocoder
/// describes it. The coordinates came out of JSON, so they are finite.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Place {
    pub name: String,
    /// The first administrative level (a state, a land, a prefecture), when known.
    pub region: Option<String>,
    pub country: Option<String>,
    #[specta(type = Finite)]
    pub latitude: f64,
    #[specta(type = Finite)]
    pub longitude: f64,
}

impl Place {
    /// Whether the coordinates name a point on the globe: a hand-edited settings file can hold
    /// anything (JSON itself cannot spell `NaN`, and serde rejects an overflowing exponent).
    #[must_use]
    pub fn is_valid(&self) -> bool {
        (-90.0..=90.0).contains(&self.latitude) && (-180.0..=180.0).contains(&self.longitude)
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// A forecast source. Async because the real one waits on the network; the service keeps its
/// own reasoning synchronous and only awaits at the edge.
pub trait WeatherProvider: Send + Sync {
    /// The forecast for a point, trimmed to the current hour and the kept horizon.
    fn forecast(
        &self,
        latitude: f64,
        longitude: f64,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>>;
    /// Places matching a typed name, best first.
    fn search(&self, query: String) -> BoxFuture<'_, Result<Vec<Place>, FetchError>>;
    /// For diagnostics.
    fn name(&self) -> &'static str;
}

impl std::fmt::Debug for dyn WeatherProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WeatherProvider")
            .field("name", &self.name())
            .finish()
    }
}

/// The Open-Meteo adapter. The HTTP client is built on first use so constructing the module
/// (and the app state in tests) touches nothing.
#[derive(Debug, Default)]
pub struct OpenMeteo {
    client: OnceLock<Option<reqwest::Client>>,
}

impl OpenMeteo {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    fn client(&self) -> Result<&reqwest::Client, FetchError> {
        self.client
            .get_or_init(|| {
                reqwest::Client::builder()
                    .user_agent(USER_AGENT)
                    .timeout(REQUEST_TIMEOUT)
                    .build()
                    .map_err(|error| {
                        tracing::warn!(%error, "weather http client unavailable");
                        error
                    })
                    .ok()
            })
            .as_ref()
            .ok_or(FetchError::Provider)
    }

    async fn get_text(&self, url: &str) -> Result<String, FetchError> {
        let response = self
            .client()?
            .get(url)
            .send()
            .await
            .map_err(|error| classify(&error))?
            .error_for_status()
            .map_err(|error| classify(&error))?;
        response.text().await.map_err(|error| classify(&error))
    }
}

/// A transport failure is "offline"; an answer we cannot use is the provider's.
fn classify(error: &reqwest::Error) -> FetchError {
    if error.is_status() || error.is_decode() || error.is_body() {
        FetchError::Provider
    } else {
        FetchError::Offline
    }
}

impl WeatherProvider for OpenMeteo {
    fn forecast(
        &self,
        latitude: f64,
        longitude: f64,
    ) -> BoxFuture<'_, Result<Forecast, FetchError>> {
        Box::pin(async move {
            let body = self.get_text(&forecast_url(latitude, longitude)).await?;
            parse_forecast(&body)
        })
    }

    fn search(&self, query: String) -> BoxFuture<'_, Result<Vec<Place>, FetchError>> {
        Box::pin(async move {
            let Some(url) = search_url(&query) else {
                return Ok(Vec::new());
            };
            let body = self.get_text(&url).await?;
            parse_places(&body)
        })
    }

    fn name(&self) -> &'static str {
        "open-meteo"
    }
}

/// The forecast request for a point: metric units, the place's own zone, seven days.
#[must_use]
pub fn forecast_url(latitude: f64, longitude: f64) -> String {
    format!(
        "{FORECAST_ENDPOINT}?latitude={latitude:.4}&longitude={longitude:.4}\
         &current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,\
         wind_speed_10m,surface_pressure\
         &hourly=temperature_2m,weather_code,is_day,precipitation_probability,uv_index\
         &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,\
         precipitation_probability_max\
         &timezone=auto&forecast_days=7"
    )
}

/// The geocoding request for a typed name; `None` for a blank query, which needs no request.
#[must_use]
pub fn search_url(query: &str) -> Option<String> {
    let name = query.trim();
    if name.is_empty() {
        return None;
    }
    let url = tauri::Url::parse_with_params(
        GEOCODING_ENDPOINT,
        [
            ("name", name),
            ("count", &SEARCH_RESULTS.to_string()),
            ("language", "en"),
            ("format", "json"),
        ],
    )
    .ok()?;
    Some(url.into())
}

#[derive(Deserialize)]
struct ForecastResponse {
    timezone: String,
    current: CurrentResponse,
    hourly: HourlyResponse,
    daily: DailyResponse,
}

#[derive(Deserialize)]
struct CurrentResponse {
    time: String,
    temperature_2m: f64,
    relative_humidity_2m: f64,
    apparent_temperature: f64,
    is_day: u8,
    weather_code: u16,
    wind_speed_10m: f64,
    surface_pressure: f64,
}

#[derive(Deserialize)]
struct HourlyResponse {
    time: Vec<String>,
    temperature_2m: Vec<Option<f64>>,
    weather_code: Vec<Option<u16>>,
    is_day: Vec<Option<u8>>,
    precipitation_probability: Vec<Option<f64>>,
    uv_index: Vec<Option<f64>>,
}

#[derive(Deserialize)]
struct DailyResponse {
    time: Vec<String>,
    weather_code: Vec<Option<u16>>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    sunrise: Vec<String>,
    sunset: Vec<String>,
    precipitation_probability_max: Vec<Option<f64>>,
}

/// A column of a table response; a missing cell is `None`, a short column is padding.
fn cell<T: Copy>(column: &[Option<T>], index: usize) -> Option<T> {
    column.get(index).copied().flatten()
}

fn percent(value: Option<f64>) -> Option<u8> {
    // Clamped to 0..=100 first, so the cast can neither truncate nor lose a sign.
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    value.map(|v| v.round().clamp(0.0, 100.0) as u8)
}

/// Parses a forecast response body; hours already past are dropped.
pub fn parse_forecast(body: &str) -> Result<Forecast, FetchError> {
    let response: ForecastResponse = serde_json::from_str(body).map_err(|error| {
        tracing::debug!(%error, "forecast response did not parse");
        FetchError::Provider
    })?;
    let current = &response.current;
    let hourly: Vec<HourForecast> = response
        .hourly
        .time
        .iter()
        .enumerate()
        .filter_map(|(index, time)| {
            let hourly = &response.hourly;
            Some(HourForecast {
                time: time.clone(),
                condition: WeatherCondition::from_code(cell(&hourly.weather_code, index)?),
                is_day: cell(&hourly.is_day, index).unwrap_or(1) == 1,
                temperature_c: cell(&hourly.temperature_2m, index)?,
                precipitation_percent: percent(cell(&hourly.precipitation_probability, index)),
            })
        })
        .collect();
    // The UV index is hourly only; the current hour is the last one that has started.
    let uv_index = response
        .hourly
        .time
        .iter()
        .rposition(|time| *time <= current.time)
        .and_then(|index| cell(&response.hourly.uv_index, index));
    let daily = response
        .daily
        .time
        .iter()
        .enumerate()
        .filter_map(|(index, date)| {
            let daily = &response.daily;
            Some(DayForecast {
                date: date.clone(),
                condition: WeatherCondition::from_code(cell(&daily.weather_code, index)?),
                high_c: cell(&daily.temperature_2m_max, index)?,
                low_c: cell(&daily.temperature_2m_min, index)?,
                sunrise: daily.sunrise.get(index)?.clone(),
                sunset: daily.sunset.get(index)?.clone(),
                precipitation_percent: percent(cell(&daily.precipitation_probability_max, index)),
            })
        })
        .collect();
    let mut forecast = Forecast {
        timezone: response.timezone,
        current: CurrentConditions {
            time: current.time.clone(),
            condition: WeatherCondition::from_code(current.weather_code),
            is_day: current.is_day == 1,
            temperature_c: current.temperature_2m,
            apparent_temperature_c: current.apparent_temperature,
            humidity_percent: percent(Some(current.relative_humidity_2m)).unwrap_or(0),
            wind_kmh: current.wind_speed_10m,
            pressure_hpa: current.surface_pressure,
            uv_index,
        },
        hourly,
        daily,
    };
    forecast.trim();
    Ok(forecast)
}

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(default)]
    results: Vec<PlaceResponse>,
}

#[derive(Deserialize)]
struct PlaceResponse {
    name: String,
    latitude: f64,
    longitude: f64,
    #[serde(default)]
    admin1: Option<String>,
    #[serde(default)]
    country: Option<String>,
}

/// Parses a geocoding response body; no `results` key means nothing matched.
pub fn parse_places(body: &str) -> Result<Vec<Place>, FetchError> {
    let response: SearchResponse = serde_json::from_str(body).map_err(|error| {
        tracing::debug!(%error, "geocoding response did not parse");
        FetchError::Provider
    })?;
    Ok(response
        .results
        .into_iter()
        .take(SEARCH_RESULTS)
        .map(|place| Place {
            name: place.name,
            region: place.admin1.filter(|region| !region.is_empty()),
            country: place.country.filter(|country| !country.is_empty()),
            latitude: place.latitude,
            longitude: place.longitude,
        })
        .collect())
}
