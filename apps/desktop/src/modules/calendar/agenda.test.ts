import type { CalendarEvent, CalendarSnapshot, SourceView } from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import {
  dayKeyOf,
  eventsByDay,
  formatDayHeading,
  formatTimeRange,
  inProgress,
  isFetching,
  marksByDay,
  needsAttention,
  startOfDay,
  tintBySource,
  upcoming,
} from './agenda';

const at = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute).getTime();

let counter = 0;
const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => {
  counter += 1;
  return {
    id: `work:e${String(counter)}`,
    sourceId: 'work',
    title: `Event ${String(counter)}`,
    location: null,
    startMs: at(2026, 9, 26, 9),
    endMs: at(2026, 9, 26, 10),
    allDay: false,
    link: null,
    isMeeting: false,
    ...overrides,
  };
};

const source = (overrides: Partial<SourceView> = {}): SourceView => ({
  id: 'work',
  name: 'Work',
  color: 'purple',
  enabled: true,
  host: 'calendar.example.com',
  status: { kind: 'ok' },
  fetchedAtMs: at(2026, 9, 26, 8, 55),
  eventCount: 3,
  ...overrides,
});

const snapshot = (sources: SourceView[]): CalendarSnapshot => ({
  sources,
  events: [],
  windowStartMs: at(2026, 7, 28),
  windowEndMs: at(2026, 11, 25),
  offline: false,
});

describe('day keys', () => {
  it('names a local day and finds its midnight', () => {
    expect(dayKeyOf(at(2026, 9, 26, 23, 59))).toBe('2026-09-26');
    expect(dayKeyOf(at(2026, 1, 5))).toBe('2026-01-05');
    expect(startOfDay('2026-09-26')).toBe(at(2026, 9, 26));
  });
});

describe('eventsByDay', () => {
  it('buckets events by the local days they cover, in feed order', () => {
    const morning = event({ startMs: at(2026, 9, 26, 9), endMs: at(2026, 9, 26, 10) });
    const late = event({ startMs: at(2026, 9, 26, 23), endMs: at(2026, 9, 27, 1) });
    const retreat = event({
      startMs: at(2026, 9, 28),
      endMs: at(2026, 9, 30),
      allDay: true,
    });
    const days = eventsByDay([morning, late, retreat]);
    expect(days.get('2026-09-26')).toEqual([morning, late]);
    // Crossing midnight puts the call on both days.
    expect(days.get('2026-09-27')).toEqual([late]);
    // A two-day all-day event ends at midnight on the 30th and does not spill onto it.
    expect(days.get('2026-09-28')).toEqual([retreat]);
    expect(days.get('2026-09-29')).toEqual([retreat]);
    expect(days.has('2026-09-30')).toBe(false);
  });

  it('caps how far a single event is spread', () => {
    const endless = event({ startMs: at(2026, 1, 1), endMs: at(2027, 1, 1), allDay: true });
    expect(eventsByDay([endless]).size).toBe(62);
  });
});

describe('marksByDay and tintBySource', () => {
  it('colours a day by its events, skipping sources that are gone or off', () => {
    const tintOf = tintBySource([source(), source({ id: 'home', color: 'green', enabled: false })]);
    expect(tintOf('work')).toBe('purple');
    expect(tintOf('home')).toBeUndefined();
    expect(tintOf('nope')).toBeUndefined();

    const days = eventsByDay([
      event(),
      event({ sourceId: 'home' }),
      event({ startMs: at(2026, 9, 27, 9), endMs: at(2026, 9, 27, 10) }),
      event({ sourceId: 'gone', startMs: at(2026, 9, 28), endMs: at(2026, 9, 28, 1) }),
    ]);
    expect(marksByDay(days, tintOf)).toEqual({
      '2026-09-26': ['purple'],
      '2026-09-27': ['purple'],
    });
  });
});

describe('upcoming and inProgress', () => {
  it('keeps events that have not ended, in order, up to the count', () => {
    const done = event({ startMs: at(2026, 9, 26, 7), endMs: at(2026, 9, 26, 8) });
    const now = event({ startMs: at(2026, 9, 26, 8, 30), endMs: at(2026, 9, 26, 9, 30) });
    const later = event({ startMs: at(2026, 9, 26, 11), endMs: at(2026, 9, 26, 12) });
    const tomorrow = event({ startMs: at(2026, 9, 27, 9), endMs: at(2026, 9, 27, 10) });
    const nowMs = at(2026, 9, 26, 9);
    expect(upcoming([done, now, later, tomorrow], nowMs, 2)).toEqual([now, later]);
    expect(inProgress(now, nowMs)).toBe(true);
    expect(inProgress(later, nowMs)).toBe(false);
    expect(inProgress(done, nowMs)).toBe(false);
  });
});

describe('snapshot state', () => {
  it('flags sources that need the user and sources on the wire', () => {
    expect(needsAttention(snapshot([source()]))).toBe(false);
    expect(
      needsAttention(snapshot([source({ status: { kind: 'error', error: 'offline' } })])),
    ).toBe(false);
    expect(
      needsAttention(snapshot([source({ status: { kind: 'error', error: 'refused' } })])),
    ).toBe(true);
    expect(
      needsAttention(
        snapshot([source({ enabled: false, status: { kind: 'error', error: 'missingLink' } })]),
      ),
    ).toBe(false);
    expect(isFetching(snapshot([source()]))).toBe(false);
    expect(
      isFetching(snapshot([source(), source({ id: 'b', status: { kind: 'fetching' } })])),
    ).toBe(true);
  });
});

describe('formatting', () => {
  it('writes a time range on one day and names the day when the end is on another', () => {
    const call = event({ startMs: at(2026, 9, 26, 9), endMs: at(2026, 9, 26, 9, 30) });
    expect(formatTimeRange(call, 'en')).toMatch(/^9:00\s?–\s?9:30\s?AM$/);
    const late = event({ startMs: at(2026, 9, 26, 23), endMs: at(2026, 9, 27, 1) });
    expect(formatTimeRange(late, 'en')).toMatch(/Sat.*Sun/);
    expect(formatDayHeading('2026-09-26', 'en')).toBe('Saturday, September 26');
  });
});
