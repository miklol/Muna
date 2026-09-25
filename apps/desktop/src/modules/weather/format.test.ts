import { describe, expect, it } from 'vitest';

import {
  conditionKey,
  fahrenheit,
  formatDegrees,
  formatHour,
  formatPercent,
  formatSpeed,
  formatUpdated,
  formatWallTime,
  formatWeekday,
  mph,
  parseLocalIso,
  skyOf,
} from './format';

describe('weather formatting', () => {
  it('converts units the way the settings ask, and never repeats the unit next to a degree', () => {
    expect(fahrenheit(0)).toBe(32);
    expect(fahrenheit(100)).toBe(212);
    expect(mph(160.9344)).toBeCloseTo(100);
    expect(formatDegrees(17.6, 'metric', 'en')).toBe('18°');
    expect(formatDegrees(17.6, 'imperial', 'en')).toBe('64°');
    expect(formatDegrees(-3.4, 'metric', 'en')).toBe('-3°');
    // Rounds to zero without a minus sign.
    expect(formatDegrees(-0.2, 'metric', 'en')).toBe('0°');
    expect(formatSpeed(12.4, 'metric', 'en')).toBe('12 km/h');
    expect(formatSpeed(16.09, 'imperial', 'en')).toBe('10 mph');
    expect(formatPercent(55, 'en')).toBe('55%');
  });

  it('reads provider times as the place\u2019s wall clock, never as the machine\u2019s zone', () => {
    expect(parseLocalIso('2026-09-26T14:05')).toEqual({
      year: 2026,
      month: 9,
      day: 26,
      hour: 14,
      minute: 5,
    });
    expect(parseLocalIso('2026-09-26')).toEqual({
      year: 2026,
      month: 9,
      day: 26,
      hour: 0,
      minute: 0,
    });
    expect(parseLocalIso('yesterday')).toBeNull();
    expect(formatWallTime('2026-09-26T06:42', 'en')).toBe('6:42 AM');
    expect(formatWallTime('2026-09-26T18:03', 'en-GB')).toBe('18:03');
    expect(formatHour('2026-09-26T14:00', 'en')).toBe('2 PM');
    // 2026-09-26 is a Saturday everywhere; a UTC read of the string could have shifted it.
    expect(formatWeekday('2026-09-26', 'en')).toBe('Sat');
    // Unparseable input comes back as it was rather than as "Invalid Date".
    expect(formatWallTime('soon', 'en')).toBe('soon');
    expect(formatWeekday('someday', 'en')).toBe('someday');
  });

  it('formats the fetch instant on the machine clock', () => {
    const noon = new Date(2026, 8, 26, 12, 30).getTime();
    expect(formatUpdated(noon, 'en')).toBe('12:30 PM');
  });

  it('groups conditions into six skies by day and night, and names every condition', () => {
    expect(skyOf('clear', true)).toBe('clear-day');
    expect(skyOf('mainlyClear', false)).toBe('clear-night');
    expect(skyOf('partlyCloudy', true)).toBe('cloudy-day');
    expect(skyOf('overcast', false)).toBe('cloudy-night');
    expect(skyOf('fog', true)).toBe('fog-day');
    expect(skyOf('drizzle', true)).toBe('rain-day');
    expect(skyOf('rain', false)).toBe('rain-night');
    expect(skyOf('showers', true)).toBe('rain-day');
    expect(skyOf('snow', true)).toBe('snow-day');
    expect(skyOf('snowShowers', false)).toBe('snow-night');
    expect(skyOf('thunderstorm', true)).toBe('storm-day');
    expect(skyOf('unknown', false)).toBe('cloudy-night');
    expect(Object.keys(conditionKey)).toHaveLength(12);
    for (const key of Object.values(conditionKey)) {
      expect(key.startsWith('weather.condition.')).toBe(true);
    }
  });
});
