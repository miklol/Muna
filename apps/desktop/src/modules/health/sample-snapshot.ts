import type { HealthSnapshot, HealthWeekDay } from '@muna/contracts';

import { HOUR_MS, MINUTE_MS } from './format';

/** Tuesday 29 September 2026, 15:12 local — the "now" every sample is generated at. */
export const SAMPLE_NOW_MS = new Date(2026, 8, 29, 15, 12).getTime();

/** Local midnight of the sample day. */
export const SAMPLE_DAY_START_MS = new Date(2026, 8, 29).getTime();

const DAY_MS = 24 * HOUR_MS;

/** The last seven days, oldest first, today last: two good days, a quiet weekend, today so far. */
const sampleWeek = (
  today: Pick<HealthWeekDay, 'breaks' | 'water' | 'mindfulSeconds' | 'goalsMet'>,
) => {
  const days: HealthWeekDay[] = [
    {
      dayStartMs: SAMPLE_DAY_START_MS - 6 * DAY_MS,
      breaks: 7,
      water: 8,
      mindfulSeconds: 720,
      goalsMet: 3,
    },
    {
      dayStartMs: SAMPLE_DAY_START_MS - 5 * DAY_MS,
      breaks: 5,
      water: 8,
      mindfulSeconds: 0,
      goalsMet: 1,
    },
    {
      dayStartMs: SAMPLE_DAY_START_MS - 4 * DAY_MS,
      breaks: 8,
      water: 6,
      mindfulSeconds: 600,
      goalsMet: 2,
    },
    {
      dayStartMs: SAMPLE_DAY_START_MS - 3 * DAY_MS,
      breaks: 0,
      water: 2,
      mindfulSeconds: 0,
      goalsMet: 0,
    },
    {
      dayStartMs: SAMPLE_DAY_START_MS - 2 * DAY_MS,
      breaks: 0,
      water: 0,
      mindfulSeconds: 0,
      goalsMet: 0,
    },
    {
      dayStartMs: SAMPLE_DAY_START_MS - DAY_MS,
      breaks: 7,
      water: 9,
      mindfulSeconds: 660,
      goalsMet: 3,
    },
    { dayStartMs: SAMPLE_DAY_START_MS, ...today },
  ];
  return days;
};

/**
 * A snapshot for stories and tests: mid-afternoon on a working day, sitting for 34 minutes
 * with the next reminder 16 minutes away, four breaks and seven glasses so far, no flow.
 */
export const sampleSnapshot = (overrides: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  enabled: true,
  sitting: 'sitting',
  sittingSinceMs: SAMPLE_NOW_MS - 34 * MINUTE_MS,
  sittingMs: 34 * MINUTE_MS,
  nextBreakInMs: 16 * MINUTE_MS,
  breakDueSinceMs: null,
  today: {
    activeMs: 5 * HOUR_MS + 12 * MINUTE_MS,
    longestSitMs: 58 * MINUTE_MS,
    breaks: 4,
    water: 7,
    mindfulSeconds: 0,
    flows: 3,
  },
  goals: { breaks: 7, water: 8, mindfulSeconds: 600 },
  week: sampleWeek({ breaks: 4, water: 7, mindfulSeconds: 0, goalsMet: 0 }),
  streakDays: 1,
  flow: null,
  hearing: null,
  windingDown: false,
  dayStartMs: SAMPLE_DAY_START_MS,
  generatedAtMs: SAMPLE_NOW_MS,
  ...overrides,
});

/** Right after midnight, or a fresh install: nothing counted yet, the timer just started. */
export const emptySnapshot = (overrides: Partial<HealthSnapshot> = {}): HealthSnapshot =>
  sampleSnapshot({
    sittingSinceMs: SAMPLE_NOW_MS - 2 * MINUTE_MS,
    sittingMs: 2 * MINUTE_MS,
    nextBreakInMs: 48 * MINUTE_MS,
    today: {
      activeMs: 2 * MINUTE_MS,
      longestSitMs: 0,
      breaks: 0,
      water: 0,
      mindfulSeconds: 0,
      flows: 0,
    },
    week: sampleWeek({ breaks: 0, water: 0, mindfulSeconds: 0, goalsMet: 0 }).map((day) => ({
      ...day,
      breaks: 0,
      water: 0,
      mindfulSeconds: 0,
      goalsMet: 0,
    })),
    streakDays: 0,
    ...overrides,
  });
