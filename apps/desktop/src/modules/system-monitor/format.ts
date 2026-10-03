/**
 * Number formatting for the gauges. Byte counts follow the Windows convention the user
 * compares against in Task Manager and Explorer: binary divisors (1 GB = 1024³ bytes) under
 * decimal labels, so "15.9 GB" here is "15.9 GB" there. Units come from `Intl` so they
 * localise with the rest of the catalog.
 */

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;
const TIB = GIB * 1024;

const unit = (locale: string, name: string, digits: number) =>
  new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: name,
    unitDisplay: 'short',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** "512 MB", "15.9 GB", "1.82 TB": the precision Explorer shows at each size. */
export const formatBytes = (bytes: number, locale: string): string => {
  const value = Math.max(0, bytes);
  if (value >= TIB) return unit(locale, 'terabyte', 2).format(value / TIB);
  if (value >= GIB) return unit(locale, 'gigabyte', 1).format(value / GIB);
  return unit(locale, 'megabyte', 0).format(value / MIB);
};

/** "0 KB/s", "312 KB/s", "2.4 MB/s". */
export const formatRate = (bytesPerSecond: number, locale: string): string => {
  const value = Math.max(0, bytesPerSecond);
  if (value >= MIB) return unit(locale, 'megabyte-per-second', 1).format(value / MIB);
  return unit(locale, 'kilobyte-per-second', 0).format(value / KIB);
};

/** A whole percentage, "37%". */
export const formatPercent = (percent: number, locale: string): string =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    Math.min(100, Math.max(0, percent)) / 100,
  );

/** Tenths of a percent as one decimal, "12.3%", so a quiet process still reads as more than 0. */
export const formatTenths = (tenths: number, locale: string): string =>
  new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.min(1000, Math.max(0, tenths)) / 1000);

/** `used / total` as a 0–100 share; 0 when the total is unknown. */
export const share = (used: number, total: number): number =>
  total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
