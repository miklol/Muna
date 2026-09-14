# Weather

**Tier P1 · Owner: `muna-module-developer` · Status: spec**

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
