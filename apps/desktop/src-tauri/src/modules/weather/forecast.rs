//! The forecast the weather module holds and hands to the UI (docs/modules/weather.md,
//! "Data"). Metric throughout — the UI converts to °F and mph — and every time is the
//! *place's* local wall time as an ISO 8601 string without an offset (`2026-09-26T14:00`),
//! exactly as Open-Meteo reports it with `timezone=auto`: a forecast for Tokyo reads in Tokyo
//! hours wherever the machine is, and no 64-bit timestamp has to cross the IPC boundary.

use muna_core::Finite;
use serde::{Deserialize, Serialize};
use specta::Type;

/// How many hours after the current one the hourly strip carries.
pub const HOURS_KEPT: usize = 24;
/// How many days the daily row carries, today included.
pub const DAYS_KEPT: usize = 7;

/// A WMO weather interpretation code grouped for an icon, a label and a sky
/// (Open-Meteo's `weather_code`; docs/modules/weather.md "Visual").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum WeatherCondition {
    /// 0.
    Clear,
    /// 1.
    MainlyClear,
    /// 2.
    PartlyCloudy,
    /// 3.
    Overcast,
    /// 45, 48.
    Fog,
    /// 51–57.
    Drizzle,
    /// 61–67.
    Rain,
    /// 71–77.
    Snow,
    /// 80–82.
    Showers,
    /// 85, 86.
    SnowShowers,
    /// 95–99.
    Thunderstorm,
    /// Anything the table does not list.
    Unknown,
}

impl WeatherCondition {
    /// Maps a WMO code to its group.
    #[must_use]
    pub const fn from_code(code: u16) -> Self {
        match code {
            0 => Self::Clear,
            1 => Self::MainlyClear,
            2 => Self::PartlyCloudy,
            3 => Self::Overcast,
            45 | 48 => Self::Fog,
            51..=57 => Self::Drizzle,
            61..=67 => Self::Rain,
            71..=77 => Self::Snow,
            80..=82 => Self::Showers,
            85 | 86 => Self::SnowShowers,
            95..=99 => Self::Thunderstorm,
            _ => Self::Unknown,
        }
    }
}

/// The conditions at the place right now. Every number came out of JSON, which cannot spell
/// `NaN`, so they export as plain `number`s ([`Finite`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CurrentConditions {
    /// Local wall time of the reading, `YYYY-MM-DDTHH:MM`.
    pub time: String,
    pub condition: WeatherCondition,
    pub is_day: bool,
    #[specta(type = Finite)]
    pub temperature_c: f64,
    #[specta(type = Finite)]
    pub apparent_temperature_c: f64,
    pub humidity_percent: u8,
    #[specta(type = Finite)]
    pub wind_kmh: f64,
    #[specta(type = Finite)]
    pub pressure_hpa: f64,
    /// The UV index of the current hour; `None` when the provider has none.
    #[specta(type = Option<Finite>)]
    pub uv_index: Option<f64>,
}

/// One hour of the strip.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HourForecast {
    /// Local wall time, `YYYY-MM-DDTHH:MM`.
    pub time: String,
    pub condition: WeatherCondition,
    pub is_day: bool,
    #[specta(type = Finite)]
    pub temperature_c: f64,
    /// 0–100; `None` beyond the provider's horizon.
    pub precipitation_percent: Option<u8>,
}

/// One day of the row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayForecast {
    /// Local date, `YYYY-MM-DD`.
    pub date: String,
    pub condition: WeatherCondition,
    #[specta(type = Finite)]
    pub high_c: f64,
    #[specta(type = Finite)]
    pub low_c: f64,
    /// Local wall time, `YYYY-MM-DDTHH:MM`.
    pub sunrise: String,
    pub sunset: String,
    /// The day's highest hourly chance, 0–100.
    pub precipitation_percent: Option<u8>,
}

/// A whole forecast for one place.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    /// IANA zone the times are in, e.g. `Europe/Berlin`.
    pub timezone: String,
    pub current: CurrentConditions,
    /// From the current hour on, at most [`HOURS_KEPT`] entries.
    pub hourly: Vec<HourForecast>,
    /// From today on, at most [`DAYS_KEPT`] entries.
    pub daily: Vec<DayForecast>,
}

impl Forecast {
    /// Drops hours already past and everything beyond the kept horizon. Times are ISO strings
    /// of one format, so lexical order is chronological order.
    pub fn trim(&mut self) {
        let now = self.current.time.clone();
        let first = self
            .hourly
            .iter()
            .rposition(|hour| hour.time <= now)
            .unwrap_or(0);
        self.hourly.drain(..first);
        self.hourly.truncate(HOURS_KEPT);
        self.daily.truncate(DAYS_KEPT);
    }
}
