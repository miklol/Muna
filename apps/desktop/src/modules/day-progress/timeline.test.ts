import type { PomodoroState, Task } from '@muna/contracts';
import { defaultDayProgressSettings } from '@muna/contracts';
import { describe, expect, it } from 'vitest';

import {
  atMinutes,
  buildTimeline,
  findFreeStretch,
  MINUTE_MS,
  nextMinuteMs,
  shareOfDay,
  startOfDay,
  startOfNextDay,
  type TimelineItem,
} from './timeline';

/** A Tuesday at 13:30 local time; the working day is the default 09:00–18:00. */
const now = new Date(2026, 2, 10, 13, 30);
const day = startOfDay(now);
const at = (hours: number, minutes = 0): number => atMinutes(day, hours * 60 + minutes);

const task = (overrides: Partial<Task> & Pick<Task, 'id'>): Task => ({
  listId: 'inbox',
  title: overrides.id,
  notes: '',
  dueMs: null,
  allDay: false,
  completedAtMs: null,
  deletedAtMs: null,
  sortOrder: 0,
  createdAtMs: at(8),
  updatedAtMs: at(8),
  ...overrides,
});

const pomodoro = (overrides: Partial<PomodoroState> = {}): PomodoroState => ({
  phase: 'work',
  status: 'running',
  remainingMs: 20 * MINUTE_MS,
  totalMs: 25 * MINUTE_MS,
  completedInCycle: 2,
  cycleLength: 4,
  sessionsToday: 3,
  lastFinished: null,
  ...overrides,
});

const item = (overrides: Partial<TimelineItem> & Pick<TimelineItem, 'startMs'>): TimelineItem => ({
  id: `task:${String(overrides.startMs)}`,
  kind: 'task',
  title: null,
  endMs: null,
  done: false,
  paused: false,
  ...overrides,
});

const build = (input: Partial<Parameters<typeof buildTimeline>[0]> = {}) =>
  buildTimeline({
    tasks: [],
    pomodoro: null,
    settings: defaultDayProgressSettings(),
    now,
    ...input,
  });

describe('day boundaries', () => {
  it('finds local midnight on both sides of the day and the instant a minute names', () => {
    expect(startOfDay(now).getTime()).toBe(new Date(2026, 2, 10).getTime());
    expect(startOfNextDay(now).getTime()).toBe(new Date(2026, 2, 11).getTime());
    expect(atMinutes(day, 9 * 60 + 15)).toBe(new Date(2026, 2, 10, 9, 15).getTime());
    expect(atMinutes(day, 0)).toBe(day.getTime());
  });

  it('ticks at the next whole minute', () => {
    const base = new Date(2026, 2, 10, 13, 30).getTime();
    expect(nextMinuteMs(base)).toBe(base + MINUTE_MS);
    expect(nextMinuteMs(base + 1)).toBe(base + MINUTE_MS);
    expect(nextMinuteMs(base + MINUTE_MS - 1)).toBe(base + MINUTE_MS);
  });
});

describe('shareOfDay', () => {
  const start = at(9);
  const end = at(18);

  it('is the whole percentage gone, never 100 while the day is on', () => {
    expect(shareOfDay(start, start, end)).toBe(0);
    expect(shareOfDay(at(13, 30), start, end)).toBe(50);
    expect(shareOfDay(at(9, 5), start, end)).toBe(0);
    expect(shareOfDay(end - 1, start, end)).toBe(99);
  });

  it('is null before the start, from the end on, and for an empty window', () => {
    expect(shareOfDay(start - 1, start, end)).toBeNull();
    expect(shareOfDay(end, start, end)).toBeNull();
    expect(shareOfDay(at(12), start, start)).toBeNull();
  });
});

describe('findFreeStretch', () => {
  const gap = 90 * MINUTE_MS;

  it('is the rest of the window when nothing is on', () => {
    expect(findFreeStretch([], at(13, 30), at(18))).toEqual({ startMs: at(13, 30), endMs: at(18) });
  });

  it('stops at the first open item and continues after it', () => {
    const items = [item({ startMs: at(14) }), item({ startMs: at(14, 30) })];
    expect(findFreeStretch(items, at(13, 30), at(18))).toEqual({
      startMs: at(14, 30),
      endMs: at(18),
    });
  });

  it('takes the gap before an item when it is long enough', () => {
    const items = [item({ startMs: at(16) })];
    expect(findFreeStretch(items, at(13, 30), at(18))).toEqual({
      startMs: at(13, 30),
      endMs: at(16),
    });
  });

  it('skips a focus block by its end and ignores done tasks and bedtime', () => {
    const items = [
      item({ id: 'focus', kind: 'focus', startMs: at(13, 20), endMs: at(13, 45) }),
      item({ startMs: at(14), done: true }),
      item({ id: 'bedtime', kind: 'bedtime', startMs: at(23) }),
    ];
    expect(findFreeStretch(items, at(13, 30), at(18))).toEqual({
      startMs: at(13, 45),
      endMs: at(18),
    });
  });

  it('is null when every stretch left is shorter than the gap', () => {
    const items = [item({ startMs: at(14, 30) }), item({ startMs: at(15, 30) })];
    expect(findFreeStretch(items, at(13, 30), at(16, 45), gap)).toBeNull();
    expect(findFreeStretch([], at(17), at(18))).toBeNull();
    expect(findFreeStretch([], at(18), at(18))).toBeNull();
  });

  it('ignores items after the window', () => {
    expect(findFreeStretch([item({ startMs: at(19) })], at(13, 30), at(18))).toEqual({
      startMs: at(13, 30),
      endMs: at(18),
    });
  });
});

describe('buildTimeline', () => {
  it('keeps only timed, live tasks due today, sorted, and counts their completion', () => {
    const timeline = build({
      tasks: [
        task({ id: 'later', dueMs: at(16) }),
        task({ id: 'done', dueMs: at(10), completedAtMs: at(10, 5) }),
        task({ id: 'all-day', dueMs: at(12), allDay: true }),
        task({ id: 'deleted', dueMs: at(12), deletedAtMs: at(12) }),
        task({ id: 'undated' }),
        task({ id: 'yesterday', dueMs: at(-10) }),
        task({ id: 'tomorrow', dueMs: at(24) }),
        task({ id: 'midnight', dueMs: at(0) }),
      ],
    });
    expect(timeline.items.map((entry) => entry.id)).toEqual([
      'task:midnight',
      'task:done',
      'task:later',
    ]);
    expect(timeline.items[1]).toMatchObject({ kind: 'task', title: 'done', done: true });
    expect(timeline.completion).toEqual({ done: 1, total: 3 });
  });

  it('orders items that share a moment by title', () => {
    const timeline = build({
      tasks: [
        task({ id: 'b', title: 'Beta', dueMs: at(15) }),
        task({ id: 'a', title: 'Alpha', dueMs: at(15) }),
      ],
    });
    expect(timeline.items.map((entry) => entry.title)).toEqual(['Alpha', 'Beta']);
  });

  it('places the running focus phase from its elapsed time to its end', () => {
    const timeline = build({ pomodoro: pomodoro() });
    expect(timeline.items).toEqual([
      {
        id: 'focus',
        kind: 'focus',
        title: null,
        startMs: at(13, 25),
        endMs: at(13, 50),
        done: false,
        paused: false,
      },
    ]);
    expect(timeline.focusSessions).toBe(3);
  });

  it('marks a paused phase and leaves out idle timers and breaks', () => {
    expect(build({ pomodoro: pomodoro({ status: 'paused' }) }).items[0]?.paused).toBe(true);
    expect(build({ pomodoro: pomodoro({ status: 'idle' }) }).items).toEqual([]);
    expect(build({ pomodoro: pomodoro({ phase: 'shortBreak' }) }).items).toEqual([]);
    expect(build({ pomodoro: pomodoro({ status: 'idle' }) }).focusSessions).toBe(3);
  });

  it('ends the day with bedtime when one is set', () => {
    const settings = { ...defaultDayProgressSettings(), bedtimeMinutes: 23 * 60 };
    const timeline = build({ settings, tasks: [task({ id: 't', dueMs: at(16) })] });
    expect(timeline.bedtimeMs).toBe(at(23));
    expect(timeline.items.at(-1)).toMatchObject({ id: 'bedtime', kind: 'bedtime' });
    expect(build().bedtimeMs).toBeNull();
  });

  it('measures the working day and the first long free stretch from now', () => {
    const timeline = build({ tasks: [task({ id: 't', dueMs: at(16) })] });
    expect(timeline.workStartMs).toBe(at(9));
    expect(timeline.workEndMs).toBe(at(18));
    expect(timeline.dayPercent).toBe(50);
    expect(timeline.gap).toEqual({ startMs: at(13, 30), endMs: at(16) });
  });

  it('starts the free stretch at the working day before it begins, and finds none after', () => {
    const early = build({ now: new Date(2026, 2, 10, 7, 0) });
    expect(early.dayPercent).toBeNull();
    expect(early.gap).toEqual({ startMs: at(9), endMs: at(18) });
    const late = build({ now: new Date(2026, 2, 10, 18, 0) });
    expect(late.dayPercent).toBeNull();
    expect(late.gap).toBeNull();
  });

  it('honours the source toggles', () => {
    const settings = {
      ...defaultDayProgressSettings(),
      showTasks: false,
      showFocusSessions: false,
    };
    const timeline = build({
      settings,
      tasks: [task({ id: 't', dueMs: at(16) })],
      pomodoro: pomodoro(),
    });
    expect(timeline.items).toEqual([]);
    expect(timeline.completion).toEqual({ done: 0, total: 0 });
    expect(timeline.focusSessions).toBe(0);
  });
});
