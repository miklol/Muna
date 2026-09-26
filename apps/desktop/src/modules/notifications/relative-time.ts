const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

export interface RelativeTimeWords {
  /** Under a minute ago (or a clock that runs ahead). */
  readonly justNow: string;
}

/**
 * When a notification arrived, as a card says it: "Just now" under a minute, then "5 minutes
 * ago", "3 hours ago", "yesterday" or "4 days ago" in the window's locale, and the date once it
 * is a week old. `nowMs` comes from the shared minute clock so the words move with it.
 */
export const relativeTime = (
  createdAtMs: number,
  nowMs: number,
  locale: string,
  words: RelativeTimeWords,
): string => {
  const elapsed = nowMs - createdAtMs;
  if (elapsed < MINUTE_MS) return words.justNow;
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
  if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');
  if (elapsed < WEEK_MS) return relative.format(-Math.floor(elapsed / DAY_MS), 'day');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(createdAtMs));
};
