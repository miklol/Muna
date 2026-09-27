import type { AppUsage, CategoryUsage, DayUsage, ScreenTimeSnapshot } from '@muna/contracts';

import { HOUR_MS, MINUTE_MS } from './format';

/** A Tuesday at 15:12 local time, the moment the sample snapshot describes. */
export const SAMPLE_NOW = new Date(2026, 8, 29, 15, 12).getTime();
/** Midnight before `SAMPLE_NOW` (the default day reset hour). */
export const SAMPLE_DAY_START = new Date(2026, 8, 29).getTime();

const DAY_MS = 24 * HOUR_MS;

const app = (
  overrides: Partial<AppUsage> & Pick<AppUsage, 'exe' | 'name' | 'category'>,
): AppUsage => ({
  totalMs: 0,
  sessions: 1,
  longestMs: overrides.totalMs ?? 0,
  icon: null,
  limitMinutes: null,
  limitReached: false,
  ...overrides,
});

/** Today's apps, most time first: an editor, a browser, chat, a game with a limit, and Explorer. */
export const sampleApps = (): AppUsage[] => [
  app({
    exe: 'code.exe',
    name: 'Visual Studio Code',
    category: 'development',
    totalMs: 2 * HOUR_MS + 5 * MINUTE_MS,
    sessions: 9,
    longestMs: 41 * MINUTE_MS,
  }),
  app({
    exe: 'msedge.exe',
    name: 'Microsoft Edge',
    category: 'browsing',
    totalMs: 58 * MINUTE_MS,
    sessions: 14,
    longestMs: 12 * MINUTE_MS,
  }),
  app({
    exe: 'ms-teams.exe',
    name: 'Microsoft Teams',
    category: 'communication',
    totalMs: 27 * MINUTE_MS,
    sessions: 6,
    longestMs: 9 * MINUTE_MS,
  }),
  app({
    exe: 'steam.exe',
    name: 'Steam',
    category: 'games',
    totalMs: 32 * MINUTE_MS,
    sessions: 1,
    longestMs: 32 * MINUTE_MS,
    limitMinutes: 30,
    limitReached: true,
  }),
  app({
    exe: 'explorer.exe',
    name: 'Windows Explorer',
    category: 'system',
    totalMs: 4 * MINUTE_MS,
    sessions: 11,
    longestMs: MINUTE_MS,
  }),
];

/** The categories of `sampleApps`, in legend order, with the empties present at zero. */
export const sampleCategories = (): CategoryUsage[] => [
  { category: 'browsing', totalMs: 58 * MINUTE_MS },
  { category: 'development', totalMs: 2 * HOUR_MS + 5 * MINUTE_MS },
  { category: 'communication', totalMs: 27 * MINUTE_MS },
  { category: 'media', totalMs: 0 },
  { category: 'games', totalMs: 32 * MINUTE_MS },
  { category: 'productivity', totalMs: 0 },
  { category: 'system', totalMs: 4 * MINUTE_MS },
  { category: 'other', totalMs: 0 },
];

/** Seven days ending today: a quiet weekend, then work days, today still in progress. */
export const sampleWeek = (): DayUsage[] =>
  [
    5 * HOUR_MS + 40 * MINUTE_MS,
    6 * HOUR_MS,
    45 * MINUTE_MS,
    0,
    7 * HOUR_MS + 10 * MINUTE_MS,
    6 * HOUR_MS + 30 * MINUTE_MS,
    3 * HOUR_MS + 46 * MINUTE_MS,
  ].map((totalMs, index) => ({
    dayStartMs: SAMPLE_DAY_START - (6 - index) * DAY_MS,
    totalMs,
    byCategory:
      totalMs === 0
        ? []
        : [
            { category: 'development', totalMs: Math.round(totalMs * 0.55) },
            { category: 'browsing', totalMs: Math.round(totalMs * 0.25) },
            { category: 'communication', totalMs: Math.round(totalMs * 0.12) },
            { category: 'games', totalMs: Math.round(totalMs * 0.08) },
          ],
  }));

/** A working afternoon: counting, the editor in front since 14:31. */
export const sampleSnapshot = (
  overrides: Partial<ScreenTimeSnapshot> = {},
): ScreenTimeSnapshot => ({
  tracking: 'active',
  now: {
    exe: 'code.exe',
    name: 'Visual Studio Code',
    category: 'development',
    sinceMs: new Date(2026, 8, 29, 14, 31).getTime(),
    icon: null,
  },
  today: {
    totalMs: 3 * HOUR_MS + 46 * MINUTE_MS,
    switches: 41,
    longestMs: 41 * MINUTE_MS,
    averageMs: 5 * MINUTE_MS + 30_000,
  },
  apps: sampleApps(),
  categories: sampleCategories(),
  week: sampleWeek(),
  excluded: [{ exe: 'keepass.exe', name: 'KeePass' }],
  dayStartMs: SAMPLE_DAY_START,
  generatedAtMs: SAMPLE_NOW,
  ...overrides,
});

/** Just after the day reset: nothing counted, nothing in front yet. */
export const emptySnapshot = (overrides: Partial<ScreenTimeSnapshot> = {}): ScreenTimeSnapshot =>
  sampleSnapshot({
    now: null,
    today: { totalMs: 0, switches: 0, longestMs: 0, averageMs: 0 },
    apps: [],
    categories: sampleCategories().map((entry) => ({ ...entry, totalMs: 0 })),
    week: sampleWeek().map((day, index) =>
      index === 6 ? { ...day, totalMs: 0, byCategory: [] } : day,
    ),
    excluded: [],
    ...overrides,
  });
