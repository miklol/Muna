import type { AppCategory, AppUsage, CategoryUsage, ScreenTimeSnapshot } from '@muna/contracts';
import type { Translate } from '@muna/i18n';
import type { RingSegment, SegmentTint, Tint } from '@muna/ui';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * `2 h 5 min`, `2 h`, `45 min`, `30 s` or `0 min`, every unit from the catalog. Whole minutes
 * once a minute has passed: the ranking and the totals are not stopwatches.
 */
export const formatDuration = (ms: number, t: Translate): string => {
  const clamped = Math.max(0, ms);
  if (clamped < MINUTE_MS) {
    return clamped < SECOND_MS
      ? t('screenTime.duration.none')
      : t('screenTime.duration.seconds', { seconds: Math.floor(clamped / SECOND_MS) });
  }
  const minutes = Math.floor(clamped / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t('screenTime.duration.minutes', { minutes: rest });
  if (rest === 0) return t('screenTime.duration.hours', { hours });
  return t('screenTime.duration.hoursMinutes', { hours, minutes: rest });
};

/** A limit in minutes, in the same words as a duration. */
export const formatLimit = (minutes: number, t: Translate): string =>
  formatDuration(minutes * MINUTE_MS, t);

/** A moment as the locale writes the time of day ("14:02", "2:02 PM"). */
export const formatClock = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(ms));

/** The short weekday name for a day ("Mon"). */
export const formatWeekday = (dayStartMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(dayStartMs));

/** The one-letter weekday for the week chart's axis, from the same locale. */
export const formatWeekdayInitial = (dayStartMs: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'narrow' }).format(new Date(dayStartMs));

/**
 * The tint behind each category (docs/05-design-system.md#colour): the eight legend colours,
 * with `other` neutral so the rest bucket never outshines a real category.
 */
export const categoryTint: Readonly<Record<AppCategory, SegmentTint>> = {
  browsing: 'blue',
  development: 'purple',
  communication: 'green',
  media: 'cyan',
  games: 'orange',
  productivity: 'yellow',
  system: 'pink',
  other: 'neutral',
};

/**
 * The ranking bar's tint: the app's category colour, the accent for the neutral rest bucket
 * (a track has no neutral), and orange once a daily limit is reached.
 */
export const barTint = (app: Pick<AppUsage, 'category' | 'limitReached'>): Tint => {
  if (app.limitReached) return 'orange';
  const tint = categoryTint[app.category];
  return tint === 'neutral' ? 'accent' : tint;
};

/** The donut's arcs from today's categories, in legend order; empties draw nothing. */
export const categorySegments = (categories: readonly CategoryUsage[]): RingSegment[] =>
  categories.map((entry) => ({
    id: entry.category,
    value: entry.totalMs,
    tint: categoryTint[entry.category],
  }));

/** The app under `exe` in the ranking, or `null` once it left the top or was excluded. */
export const appByExe = (snapshot: ScreenTimeSnapshot | null, exe: string): AppUsage | null =>
  snapshot?.apps.find((app) => app.exe === exe) ?? null;

/** The longest total in the ranking, the bar every other row is drawn against. */
export const rankingScaleMs = (apps: readonly AppUsage[]): number =>
  Math.max(MINUTE_MS, ...apps.map((app) => app.totalMs));

/** The week's daily mean over the days that have any time, `0` for an empty week. */
export const weekAverageMs = (week: ScreenTimeSnapshot['week']): number => {
  const days = week.filter((day) => day.totalMs > 0);
  if (days.length === 0) return 0;
  return days.reduce((sum, day) => sum + day.totalMs, 0) / days.length;
};

export { HOUR_MS, MINUTE_MS };
