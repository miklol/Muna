import type { TaskDue } from '@muna/contracts';

export interface DueWords {
  today: string;
  tomorrow: string;
  yesterday: string;
  /** Joins a day and a time, e.g. "{{day}}, {{time}}". */
  dayAt: (day: string, time: string) => string;
}

const DAY_MS = 86_400_000;

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Whole local days from `now`'s day to `atMs`'s day: 0 today, 1 tomorrow, −1 yesterday. */
export const dayOffset = (atMs: number, now: number): number =>
  Math.round((startOfDay(atMs) - startOfDay(now)) / DAY_MS);

/** A timed task is overdue once its moment passes; an all-day one once its day is over. */
export const isOverdue = (due: TaskDue, now: number): boolean =>
  due.allDay ? dayOffset(due.atMs, now) < 0 : due.atMs < now;

/**
 * The due label on a task row (docs/modules/todo.md, "7. Aug at 18:00"): today, tomorrow and
 * yesterday by name, other days as a short weekday and date (with the year once it differs),
 * and the time after a comma unless the task is all-day. Formatting follows `locale`.
 */
export function describeDue(due: TaskDue, now: number, locale: string, words: DueWords): string {
  const offset = dayOffset(due.atMs, now);
  const dueDate = new Date(due.atMs);
  const sameYear = dueDate.getFullYear() === new Date(now).getFullYear();
  const day =
    offset === 0
      ? words.today
      : offset === 1
        ? words.tomorrow
        : offset === -1
          ? words.yesterday
          : new Intl.DateTimeFormat(locale, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              ...(sameYear ? {} : { year: 'numeric' }),
            }).format(dueDate);
  if (due.allDay) return day;
  const time = new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(dueDate);
  return words.dayAt(day, time);
}
