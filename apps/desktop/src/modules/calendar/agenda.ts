import type { CalendarEvent, CalendarSnapshot, SourceView, Tint } from '@muna/contracts';

/** A local calendar day as `YYYY-MM-DD`; the key the month grid and the agenda share. */
export type DayKey = string;

const pad = (value: number): string => String(value).padStart(2, '0');

/** The local day an instant falls on. */
export const dayKeyOf = (ms: number): DayKey => {
  const date = new Date(ms);
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Local midnight at the start of a day key. */
export const startOfDay = (key: DayKey): number => {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).getTime();
};

const nextDay = (key: DayKey): DayKey => {
  const date = new Date(startOfDay(key));
  date.setDate(date.getDate() + 1);
  return dayKeyOf(date.getTime());
};

/** How many days a single event may be spread over; longer ones are cut, not looped on. */
const MAX_SPAN_DAYS = 62;

/**
 * Events by the local days they touch, each day chronological. A timed event that crosses
 * midnight and a multi-day all-day event appear on every day they cover; an event ending
 * exactly at midnight does not spill onto the next day.
 */
export const eventsByDay = (
  events: readonly CalendarEvent[],
): ReadonlyMap<DayKey, readonly CalendarEvent[]> => {
  const days = new Map<DayKey, CalendarEvent[]>();
  for (const event of events) {
    const last = dayKeyOf(Math.max(event.startMs, event.endMs - 1));
    let key = dayKeyOf(event.startMs);
    for (let span = 0; span < MAX_SPAN_DAYS; span += 1) {
      const bucket = days.get(key);
      if (bucket === undefined) {
        days.set(key, [event]);
      } else {
        bucket.push(event);
      }
      if (key === last) break;
      key = nextDay(key);
    }
  }
  return days;
};

/**
 * The dots under each day of the month grid: one per event, in the source's colour, in the
 * feed's start order (so all-day events, starting at midnight, come first). The grid draws at
 * most three.
 */
export const marksByDay = (
  days: ReadonlyMap<DayKey, readonly CalendarEvent[]>,
  tintOf: (sourceId: string) => Tint | undefined,
): Record<DayKey, readonly Tint[]> => {
  const marks: Record<DayKey, Tint[]> = {};
  for (const [key, events] of days) {
    const tints: Tint[] = [];
    for (const event of events) {
      const tint = tintOf(event.sourceId);
      if (tint !== undefined) tints.push(tint);
    }
    if (tints.length > 0) marks[key] = tints;
  }
  return marks;
};

/** The colour of a source, by id; `undefined` for a source that is gone or disabled. */
export const tintBySource = (
  sources: readonly SourceView[],
): ((id: string) => Tint | undefined) => {
  const tints = new Map(sources.filter((s) => s.enabled).map((s) => [s.id, s.color] as const));
  return (id) => tints.get(id);
};

/** Some enabled source failed for a reason a retry will not fix (docs/modules/calendar.md). */
export const needsAttention = (snapshot: CalendarSnapshot): boolean =>
  snapshot.sources.some(
    (source) =>
      source.enabled && source.status.kind === 'error' && source.status.error !== 'offline',
  );

/** A request is on the wire for some source. */
export const isFetching = (snapshot: CalendarSnapshot): boolean =>
  snapshot.sources.some((source) => source.status.kind === 'fetching');

/** The next `count` events that have not ended, in start order. */
export const upcoming = (
  events: readonly CalendarEvent[],
  nowMs: number,
  count: number,
): CalendarEvent[] => events.filter((event) => event.endMs > nowMs).slice(0, count);

/** Whether an event is on right now. */
export const inProgress = (event: CalendarEvent, nowMs: number): boolean =>
  event.startMs <= nowMs && nowMs < event.endMs;

const timeFormat = (locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' });

/** `9:00 AM` in the user's locale. */
export const formatTime = (ms: number, locale: string): string => timeFormat(locale).format(ms);

/**
 * `9:00 – 9:30 AM` in the user's locale; an event that ends on another day names the end
 * day as well so a late call does not look like a short one.
 */
export const formatTimeRange = (event: CalendarEvent, locale: string): string => {
  if (dayKeyOf(event.startMs) === dayKeyOf(Math.max(event.startMs, event.endMs - 1))) {
    return timeFormat(locale).formatRange(event.startMs, event.endMs);
  }
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(event.startMs, event.endMs);
};

/** `Saturday, 26 September` for the agenda heading. */
export const formatDayHeading = (key: DayKey, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    startOfDay(key),
  );

/** `Sat 26 Sep` for a widget line that is not today. */
export const formatShortDay = (ms: number, locale: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short' }).format(ms);
