import { describe, expect, it } from 'vitest';

import { relativeTime } from './relative-time';

const words = { justNow: 'Just now' };
const now = new Date(2026, 8, 26, 9, 0).getTime();
const ago = (ms: number) => now - ms;

describe('relativeTime', () => {
  it('says just now under a minute, and for a clock that runs ahead', () => {
    expect(relativeTime(ago(0), now, 'en', words)).toBe('Just now');
    expect(relativeTime(ago(59_000), now, 'en', words)).toBe('Just now');
    expect(relativeTime(now + 5_000, now, 'en', words)).toBe('Just now');
  });

  it('counts minutes, hours and days in the locale', () => {
    expect(relativeTime(ago(60_000), now, 'en', words)).toBe('1 minute ago');
    expect(relativeTime(ago(5 * 60_000), now, 'en', words)).toBe('5 minutes ago');
    expect(relativeTime(ago(3 * 3_600_000), now, 'en', words)).toBe('3 hours ago');
    expect(relativeTime(ago(26 * 3_600_000), now, 'en', words)).toBe('yesterday');
    expect(relativeTime(ago(4 * 86_400_000), now, 'en', words)).toBe('4 days ago');
    expect(relativeTime(ago(5 * 60_000), now, 'de', words)).toBe('vor 5 Minuten');
  });

  it('shows the date once a week has passed', () => {
    expect(relativeTime(ago(8 * 86_400_000), now, 'en', words)).toBe('Sep 18, 2026');
  });
});
