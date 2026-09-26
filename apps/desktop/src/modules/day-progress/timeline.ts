import type { DayProgressSettings, PomodoroState, Task } from '@muna/contracts';
import { DAY_PROGRESS_GAP_MINUTES } from '@muna/contracts';

/**
 * The day's timeline (docs/modules/day-progress.md "Data"): today's timed tasks, the running
 * focus session and an optional bedtime, merged and sorted, with the completion count, the
 * first long free stretch of the working day and the share of that day gone. Pure — the panel
 * calls it with the snapshots it holds and `now`, so the tests pin every moment.
 */

export const MINUTE_MS = 60_000;

export type TimelineItemKind = 'task' | 'focus' | 'bedtime';

export interface TimelineItem {
  /** Stable key: `task:<id>`, `focus` or `bedtime`. */
  readonly id: string;
  readonly kind: TimelineItemKind;
  /** The task's title; `null` for focus and bedtime, which the UI names itself. */
  readonly title: string | null;
  readonly startMs: number;
  /** When a focus session ends; tasks and bedtime are moments. */
  readonly endMs: number | null;
  /** A task that is completed. */
  readonly done: boolean;
  /** A focus session whose timer is paused. */
  readonly paused: boolean;
}

export interface FreeStretch {
  readonly startMs: number;
  readonly endMs: number;
}

export interface Timeline {
  /** Every item of the day in time order. */
  readonly items: readonly TimelineItem[];
  /** Completed and total timed tasks today (spec: "counts only items with times today"). */
  readonly completion: { readonly done: number; readonly total: number };
  /** Work phases finished today, as the pomodoro module counts them. */
  readonly focusSessions: number;
  /** The first free stretch of at least [`DAY_PROGRESS_GAP_MINUTES`] left in the working day. */
  readonly gap: FreeStretch | null;
  /** The share of the working day that has passed, 0–99; `null` outside it. */
  readonly dayPercent: number | null;
  readonly workStartMs: number;
  readonly workEndMs: number;
  readonly bedtimeMs: number | null;
}

export interface TimelineInput {
  readonly tasks: readonly Task[];
  readonly pomodoro: PomodoroState | null;
  readonly settings: DayProgressSettings;
  readonly now: Date;
}

/** Local midnight of the day `now` falls in. */
export const startOfDay = (now: Date): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate());

/** Local midnight of the following day, so a day that changes clocks still ends at midnight. */
export const startOfNextDay = (now: Date): Date =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

/** The instant `minutes` after local midnight of `day`. */
export const atMinutes = (day: Date, minutes: number): number =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime();

const byStart = (a: TimelineItem, b: TimelineItem): number =>
  a.startMs - b.startMs || (a.title ?? '').localeCompare(b.title ?? '');

/** The moment an item stops occupying the day. */
const endOf = (item: TimelineItem): number => item.endMs ?? item.startMs;

/**
 * The first stretch of at least the gap length between `fromMs` and `untilMs` that no open
 * item occupies. Done tasks no longer hold their slot; bedtime is outside the working day.
 */
export function findFreeStretch(
  items: readonly TimelineItem[],
  fromMs: number,
  untilMs: number,
  minimumMs = DAY_PROGRESS_GAP_MINUTES * MINUTE_MS,
): FreeStretch | null {
  let cursor = fromMs;
  if (cursor >= untilMs) return null;
  const busy = items.filter((item) => item.kind !== 'bedtime' && !item.done);
  for (const item of busy) {
    if (endOf(item) <= cursor) continue;
    const boundary = Math.min(item.startMs, untilMs);
    if (boundary - cursor >= minimumMs) return { startMs: cursor, endMs: boundary };
    if (item.startMs >= untilMs) return null;
    cursor = Math.max(cursor, endOf(item));
    if (cursor >= untilMs) return null;
  }
  return untilMs - cursor >= minimumMs ? { startMs: cursor, endMs: untilMs } : null;
}

/** The whole share of `[startMs, endMs)` that has passed at `nowMs`, or `null` outside it. */
export const shareOfDay = (nowMs: number, startMs: number, endMs: number): number | null => {
  if (endMs <= startMs || nowMs < startMs || nowMs >= endMs) return null;
  return Math.min(99, Math.floor(((nowMs - startMs) / (endMs - startMs)) * 100));
};

export function buildTimeline({ tasks, pomodoro, settings, now }: TimelineInput): Timeline {
  const nowMs = now.getTime();
  const day = startOfDay(now);
  const dayStartMs = day.getTime();
  const dayEndMs = startOfNextDay(now).getTime();
  const items: TimelineItem[] = [];

  if (settings.showTasks) {
    for (const task of tasks) {
      if (task.dueMs === null || task.allDay || task.deletedAtMs !== null) continue;
      if (task.dueMs < dayStartMs || task.dueMs >= dayEndMs) continue;
      items.push({
        id: `task:${task.id}`,
        kind: 'task',
        title: task.title,
        startMs: task.dueMs,
        endMs: null,
        done: task.completedAtMs !== null,
        paused: false,
      });
    }
  }
  const timed = items.filter((item) => item.kind === 'task');
  const completion = {
    done: timed.filter((item) => item.done).length,
    total: timed.length,
  };

  if (
    settings.showFocusSessions &&
    pomodoro !== null &&
    pomodoro.status !== 'idle' &&
    pomodoro.phase === 'work'
  ) {
    const elapsedMs = Math.max(0, pomodoro.totalMs - pomodoro.remainingMs);
    items.push({
      id: 'focus',
      kind: 'focus',
      title: null,
      startMs: nowMs - elapsedMs,
      endMs: nowMs + Math.max(0, pomodoro.remainingMs),
      done: false,
      paused: pomodoro.status === 'paused',
    });
  }

  const bedtimeMs =
    settings.bedtimeMinutes === null ? null : atMinutes(day, settings.bedtimeMinutes);
  if (bedtimeMs !== null) {
    items.push({
      id: 'bedtime',
      kind: 'bedtime',
      title: null,
      startMs: bedtimeMs,
      endMs: null,
      done: false,
      paused: false,
    });
  }

  items.sort(byStart);
  const workStartMs = atMinutes(day, settings.workStartMinutes);
  const workEndMs = atMinutes(day, settings.workEndMinutes);

  return {
    items,
    completion,
    focusSessions: settings.showFocusSessions ? (pomodoro?.sessionsToday ?? 0) : 0,
    gap: findFreeStretch(items, Math.max(nowMs, workStartMs), workEndMs),
    dayPercent: shareOfDay(nowMs, workStartMs, workEndMs),
    workStartMs,
    workEndMs,
    bedtimeMs,
  };
}

/** The start of the next whole minute after `nowMs`, for the panel's tick. */
export const nextMinuteMs = (nowMs: number): number =>
  (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;
