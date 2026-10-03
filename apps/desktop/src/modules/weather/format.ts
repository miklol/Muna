import type { Units, WeatherCondition } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';

/**
 * Formatting for the weather panel (docs/modules/weather.md). The forecast arrives metric with
 * every time as the *place's* local wall time (`YYYY-MM-DDTHH:MM`, no offset); conversion to
 * °F and mph and every reading of a time happen here, through `Intl`, so nothing is hard-coded
 * to one locale.
 */

export const fahrenheit = (celsius: number): number => (celsius * 9) / 5 + 32;

export const mph = (kmh: number): number => kmh / 1.609_344;

/** `18°` — the unit is implied by the settings and never repeated next to every number. */
export const formatDegrees = (celsius: number, units: Units, locale: string): string => {
  const value = units === 'imperial' ? fahrenheit(celsius) : celsius;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0, signDisplay: 'auto' }).format(
    Math.round(value) === 0 ? 0 : value,
  )}°`;
};

/** `12 km/h` or `8 mph`. */
export const formatSpeed = (kmh: number, units: Units, locale: string): string =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: units === 'imperial' ? 'mile-per-hour' : 'kilometer-per-hour',
    unitDisplay: 'short',
    maximumFractionDigits: 0,
  }).format(units === 'imperial' ? mph(kmh) : kmh);

/** `55%`. */
export const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

/** The digits of a pressure or a UV index; the caption around them comes from i18n. */
export const formatNumber = (value: number, locale: string): string =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);

interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const LOCAL_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/**
 * Splits a provider time (`2026-09-26T14:00`, or a bare date) into its parts. Never goes
 * through `Date.parse`, which would read the string as UTC or as the machine's zone and shift
 * a forecast for another city by hours.
 */
export const parseLocalIso = (iso: string): LocalDateTime | null => {
  const match = LOCAL_ISO.exec(iso);
  if (match === null) return null;
  const [, year, month, day, hour, minute] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: hour === undefined ? 0 : Number(hour),
    minute: minute === undefined ? 0 : Number(minute),
  };
};

/**
 * A `Date` whose *local* fields equal the wall time, so `Intl.DateTimeFormat` without a
 * `timeZone` prints the place's own hours wherever the machine is.
 */
const asWallDate = (time: LocalDateTime): Date =>
  new Date(time.year, time.month - 1, time.day, time.hour, time.minute);

/** `10:15` / `10:15 AM` for a provider time; the input as it came when it does not parse. */
export const formatWallTime = (iso: string, locale: string): string => {
  const time = parseLocalIso(iso);
  if (time === null) return iso;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    asWallDate(time),
  );
};

/** `10 AM` / `10` for the hourly strip. */
export const formatHour = (iso: string, locale: string): string => {
  const time = parseLocalIso(iso);
  if (time === null) return iso;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(asWallDate(time));
};

/** `Tue` for the daily row. */
export const formatWeekday = (date: string, locale: string): string => {
  const time = parseLocalIso(date);
  if (time === null) return date;
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(asWallDate(time));
};

/** The machine's own clock reading of when the forecast was fetched (a real instant). */
export const formatUpdated = (fetchedAtMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
    new Date(fetchedAtMs),
  );

/** The sky behind the panel: six condition groups, each by day and by night. */
export type Sky =
  | 'clear-day'
  | 'clear-night'
  | 'cloudy-day'
  | 'cloudy-night'
  | 'fog-day'
  | 'fog-night'
  | 'rain-day'
  | 'rain-night'
  | 'snow-day'
  | 'snow-night'
  | 'storm-day'
  | 'storm-night';

type SkyGroup = 'clear' | 'cloudy' | 'fog' | 'rain' | 'snow' | 'storm';

const SKY_GROUP: Record<WeatherCondition, SkyGroup> = {
  clear: 'clear',
  mainlyClear: 'clear',
  partlyCloudy: 'cloudy',
  overcast: 'cloudy',
  fog: 'fog',
  drizzle: 'rain',
  rain: 'rain',
  showers: 'rain',
  snow: 'snow',
  snowShowers: 'snow',
  thunderstorm: 'storm',
  unknown: 'cloudy',
};

export const skyOf = (condition: WeatherCondition, isDay: boolean): Sky =>
  `${SKY_GROUP[condition]}-${isDay ? 'day' : 'night'}`;

export const conditionKey: Record<WeatherCondition, MessageKey> = {
  clear: 'weather.condition.clear',
  mainlyClear: 'weather.condition.mainlyClear',
  partlyCloudy: 'weather.condition.partlyCloudy',
  overcast: 'weather.condition.overcast',
  fog: 'weather.condition.fog',
  drizzle: 'weather.condition.drizzle',
  rain: 'weather.condition.rain',
  snow: 'weather.condition.snow',
  showers: 'weather.condition.showers',
  snowShowers: 'weather.condition.snowShowers',
  thunderstorm: 'weather.condition.thunderstorm',
  unknown: 'weather.condition.unknown',
};
