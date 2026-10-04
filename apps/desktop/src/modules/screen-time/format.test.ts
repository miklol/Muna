import { describe, expect, it } from 'vitest';

import { i18n } from '../../lib/i18n';
import {
  appByExe,
  barTint,
  categorySegments,
  formatClock,
  formatDuration,
  formatLimit,
  formatWeekday,
  formatWeekdayInitial,
  HOUR_MS,
  MINUTE_MS,
  rankingScaleMs,
  weekAverageMs,
} from './format';
import { sampleCategories, sampleSnapshot, sampleWeek } from './sample-snapshot';

const t = i18n.t.bind(i18n);

describe('screen time formatting', () => {
  it('writes durations in hours and minutes, seconds under a minute, and 0 min for nothing', () => {
    expect(formatDuration(0, t)).toBe('0 min');
    expect(formatDuration(999, t)).toBe('0 min');
    expect(formatDuration(30_000, t)).toBe('30 s');
    expect(formatDuration(45 * MINUTE_MS, t)).toBe('45 min');
    expect(formatDuration(2 * HOUR_MS, t)).toBe('2 h');
    expect(formatDuration(2 * HOUR_MS + 5 * MINUTE_MS + 59_000, t)).toBe('2 h 5 min');
    expect(formatDuration(-5, t)).toBe('0 min');
    expect(formatLimit(90, t)).toBe('1 h 30 min');
  });

  it('formats the clock and the weekdays for the locale', () => {
    const monday = new Date(2026, 8, 28, 9, 5).getTime();
    expect(formatClock(monday, 'en-GB')).toBe('09:05');
    expect(formatWeekday(monday, 'en')).toBe('Mon');
    expect(formatWeekdayInitial(monday, 'en')).toBe('M');
  });

  it('turns the categories into ring segments in legend order, empties included', () => {
    const segments = categorySegments(sampleCategories());
    expect(segments.map((segment) => segment.id)).toEqual([
      'browsing',
      'development',
      'communication',
      'media',
      'games',
      'productivity',
      'system',
      'other',
    ]);
    expect(segments[0]).toEqual({ id: 'browsing', value: 58 * MINUTE_MS, tint: 'blue' });
    expect(segments[7]).toEqual({ id: 'other', value: 0, tint: 'neutral' });
  });

  it('tints a bar by category, the accent for the rest bucket, orange past a limit', () => {
    expect(barTint({ category: 'development', limitReached: false })).toBe('purple');
    expect(barTint({ category: 'other', limitReached: false })).toBe('accent');
    expect(barTint({ category: 'development', limitReached: true })).toBe('orange');
  });

  it('finds an app by exe and scales the ranking to the leader, never under a minute', () => {
    const snapshot = sampleSnapshot();
    expect(appByExe(snapshot, 'steam.exe')?.name).toBe('Steam');
    expect(appByExe(snapshot, 'nope.exe')).toBeNull();
    expect(appByExe(null, 'code.exe')).toBeNull();
    expect(rankingScaleMs(snapshot.apps)).toBe(2 * HOUR_MS + 5 * MINUTE_MS);
    expect(rankingScaleMs([])).toBe(MINUTE_MS);
  });

  it('averages the week over the days that have time', () => {
    const week = sampleWeek();
    const busy = week.filter((day) => day.totalMs > 0);
    const expected = busy.reduce((sum, day) => sum + day.totalMs, 0) / busy.length;
    expect(weekAverageMs(week)).toBeCloseTo(expected);
    expect(weekAverageMs(week.map((day) => ({ ...day, totalMs: 0 })))).toBe(0);
  });
});
