# Weather

**Tier P1 · Owner: `muna-module-developer` · Status: implemented (M3-E4)**

## Reference

`weather-feature`, `weather-feature-2`. Compact: big condition icon, 17°C, condition, H/L,
feels-like, chips (temp/humidity/wind), 12-hour strip. Expanded: humidity/wind/UV/pressure
chips, sunrise/sunset, 7-day, photographic sky background that follows condition and time.

## Data

Open-Meteo forecast API (no key): hourly temp/apparent/precip/weathercode/wind/uv/pressure,
daily min/max/sunrise/sunset; geocoding API for manual city. Location via
`Windows.Devices.Geolocation.Geolocator` (permission prompt) or manual city. Refresh 15 min,
cache last response; °C/°F; wind km/h / mph.

## Visual

Sky backgrounds: 6 conditions × day/night as compressed WebP (< 60 KB each) with a slow
Ken-Burns drift (disabled under reduced motion). Icons: animated weather set (Lucide-style
outline or Meteocons-like, license-checked).

## Acceptance criteria

- Given location denied, then the module shows a "Choose a city" empty state, no repeated prompts.
- Given offline, then last forecast shows with a timestamp chip.

### Implementation notes (M3-E4)

The module is `src-tauri/src/modules/weather` + `src/modules/weather`; the location comes
through a new `muna-platform::Location` trait (fake + Windows `Geolocator`), the forecast
through a provider adapter over `reqwest` (rustls, HTTP/2, system proxy).

- **Off by default.** `settings.modules.weather.enabled` is `false` until the user turns it on
  in Settings → Weather; the service makes no request, asks Windows nothing and the panel shows
  a plain invitation with *Open settings*. Turning it off deletes the cached forecast
  (`Store` meta `weather:forecast`). This is the module's privacy stance (PRD "local-first"):
  the only network calls are the two Open-Meteo endpoints, with the user agent
  `Muna/<version> (+https://github.com/miklol/Muna)`, and nothing is sent until asked.
- **Location.** `LocationSetting::Auto` calls `Geolocator.RequestAccessAsync` once, then
  `GetGeopositionAsync` with a 15 min maximum age and a 30 s timeout (`PositionAccuracy::Default`,
  no tracking; no fix in time is a transient failure, never a hang). Both run on a short-lived
  thread that initialises a COM apartment first: **measured** on Win11, the `RequestAccessAsync`
  completion never fires on a thread without one (a tokio blocking thread; the implicit MTA is
  not enough) and a join hangs forever, while with `CoInitializeEx(COINIT_MULTITHREADED)` it
  answers in about 12 ms. Every wait has a deadline (60 s for the access check, which may sit
  behind the packaged consent prompt; 40 s for the fix; 110 s for the thread): the broker was
  once seen not answering at all, and past the deadline the operation is cancelled and the
  service gets a transient failure to retry. *Denied* (`E_ACCESSDENIED`
  or `GeolocationAccessStatus::Denied`) sticks: the panel shows *Choose a city* and Windows is
  not asked again until the user presses *Try again* (`WeatherCommand::RetryLocation`) or
  switches to a city — the acceptance criterion "no repeated prompts". *Unavailable* (no
  location source) shows the same empty state without a retry; a transient failure retries
  with backoff. `LocationSetting::Manual { place }` takes a `Place` from the geocoder
  (`weather_search`, refused with `weather.disabled` while the module is off); a place with
  coordinates off the globe fails the whole settings entry and falls back to `Auto`.
- **Coordinates are rounded to 0.01°** (about a kilometre) before they leave the PC or reach
  the cache key, so the provider never sees a rooftop. The cache is restored only for the same
  rounded point.
- **Service.** `WeatherService` is a pure reducer (`plan` / `complete_locate` /
  `complete_fetch` / `command` / `apply_settings`, all under `tests/weather.rs` with a stub
  provider and the fake clock); `WeatherModule` runs it on one tokio task that sleeps until
  `next_wake` and wakes on commands, settings and `SessionLockChanged { locked: false }`.
  Refresh every 15 min; a failed fetch backs off 1 → 2 → 4 → 8 min, capped at 15; results of a
  superseded request (generation counter) are dropped. Units are a view setting — changing
  them re-emits the same forecast, no request.
- **Contract.** `get_weather_snapshot` → `WeatherSnapshot { enabled, units, location, forecast,
  fetchedAtMs, fetching, error }`; `weather_command(Refresh | RetryLocation)` returns the
  snapshot as it stands; `weather_search(query)` → `Place[]` or `weather.disabled` /
  `weather.offline` / `weather.provider`; `WeatherChanged { snapshot }`. Forecast times are the
  *place's* wall clock (`YYYY-MM-DDTHH:MM`, Open-Meteo `timezone=auto`) and the UI formats them
  without ever parsing them as instants. All floats cross the wire through the new
  `muna_core::Finite` specta marker (specta exports a bare `f64` as `number | null`).
- **Panel.** The moment now (glyph, temperature, condition, high / low, feels like, place),
  chips for humidity, wind, UV, pressure, sunrise and sunset, the next twelve hours and the
  week; a stale forecast keeps showing with an *Updated HH:MM* chip when the last refresh
  failed (acceptance criterion "offline → last forecast with a timestamp chip"). No timers in
  the UI. The sky is a gradient chosen by `data-sky` (six condition groups × day/night).
- **Deviations from the spec.** Photographic WebP skies with the Ken-Burns drift and the
  animated icon set are deferred — the panel ships no binary assets; skies are CSS gradients
  behind the black-glass material and icons are Lucide outlines, sun becoming moon after
  sunset. Weather alerts are not fetched (Open-Meteo has no alert endpoint for every region).
  The compact / expanded split is one panel here; the strip form waits for the live-activity
  vocabulary to gain a weather slot.
- **Packaging.** The MSIX manifest needs `<DeviceCapability Name="location" />`;
  unpackaged builds go through the desktop-app location toggle in Settings → Privacy.
  `RequestAccessAsync` may want a UI thread in packaged builds to show the consent prompt —
  the service calls it from its own COM thread, so if the packaged prompt does not appear the
  fallback is the *Choose a city* path (tracked for the M4 MSIX pass).
