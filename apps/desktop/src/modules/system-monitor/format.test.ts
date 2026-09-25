import { describe, expect, it } from 'vitest';

import { formatBytes, formatPercent, formatRate, formatTenths, share } from './format';

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

describe('system monitor formatting', () => {
  it('formats byte counts with binary divisors at the precision Explorer uses', () => {
    expect(formatBytes(0, 'en')).toBe('0 MB');
    expect(formatBytes(512 * MIB, 'en')).toBe('512 MB');
    expect(formatBytes(15.9 * GIB, 'en')).toBe('15.9 GB');
    expect(formatBytes(1.82 * 1024 * GIB, 'en')).toBe('1.82 TB');
    expect(formatBytes(-5, 'en')).toBe('0 MB');
  });

  it('formats transfer rates in kB/s below a megabyte, MB/s above', () => {
    expect(formatRate(0, 'en')).toBe('0 kB/s');
    expect(formatRate(312 * KIB, 'en')).toBe('312 kB/s');
    expect(formatRate(2.4 * MIB, 'en')).toBe('2.4 MB/s');
  });

  it('formats percentages whole and tenths to one decimal, clamped', () => {
    expect(formatPercent(37, 'en')).toBe('37%');
    expect(formatPercent(140, 'en')).toBe('100%');
    expect(formatPercent(-3, 'en')).toBe('0%');
    expect(formatTenths(123, 'en')).toBe('12.3%');
    expect(formatTenths(4, 'en')).toBe('0.4%');
    expect(formatTenths(2000, 'en')).toBe('100.0%');
  });

  it('turns used and total into a 0–100 share, 0 when the total is unknown', () => {
    expect(share(1, 4)).toBe(25);
    expect(share(5, 4)).toBe(100);
    expect(share(3, 0)).toBe(0);
    expect(share(-1, 4)).toBe(0);
  });
});
