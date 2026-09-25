import { describe, expect, it } from 'vitest';

import { dayOffset, describeDue, isOverdue } from './due-label';
import { parseTask } from './parse-task';

/** A Friday at 09:00 local time. */
const now = new Date(2026, 8, 25, 9, 0, 0);
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m, d, h, min).getTime();

describe('parseTask', () => {
  it('splits a title from a date phrase with a time', () => {
    expect(parseTask('Call Sam tomorrow 3pm', now)).toEqual({
      title: 'Call Sam',
      due: { atMs: local(2026, 8, 26, 15), allDay: false },
      phrase: 'tomorrow 3pm',
    });
  });

  it('reads a day without a time as an all-day task at local midnight', () => {
    const parsed = parseTask('Pay rent next monday', now);
    expect(parsed.title).toBe('Pay rent');
    expect(parsed.due).toEqual({ atMs: local(2026, 8, 28), allDay: true });
  });

  it('drops the word that only introduced the date', () => {
    expect(parseTask('Submit report by next monday', now).title).toBe('Submit report');
    expect(parseTask('Dentist on 7 Aug at 18:00', now)).toMatchObject({
      title: 'Dentist',
      due: { atMs: local(2027, 7, 7, 18), allDay: false },
    });
  });

  it('tidies a leading date phrase and its separator', () => {
    expect(parseTask('Tomorrow: call Sam', now)).toMatchObject({ title: 'call Sam' });
  });

  it('leaves plain text alone', () => {
    expect(parseTask('  Buy   milk ', now)).toEqual({ title: 'Buy milk', due: null, phrase: null });
  });

  it('keeps a bare date as the title rather than refusing an empty one', () => {
    expect(parseTask('tomorrow', now)).toEqual({ title: 'tomorrow', due: null, phrase: null });
  });

  it('resolves weekdays forward', () => {
    // `now` is a Friday: "Friday" means today, "Thursday" means next week.
    expect(parseTask('Gym Friday', now).due?.atMs).toBe(local(2026, 8, 25));
    expect(parseTask('Gym Thursday', now).due?.atMs).toBe(local(2026, 9, 1));
  });
});

describe('due labels', () => {
  const words = {
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    dayAt: (day: string, time: string) => `${day}, ${time}`,
  };
  const at = now.getTime();

  it('counts whole local days', () => {
    expect(dayOffset(local(2026, 8, 25, 23, 59), at)).toBe(0);
    expect(dayOffset(local(2026, 8, 26, 0, 1), at)).toBe(1);
    expect(dayOffset(local(2026, 8, 24, 23, 59), at)).toBe(-1);
    expect(dayOffset(local(2026, 9, 5), at)).toBe(10);
  });

  it('names today, tomorrow and yesterday and adds the time unless all-day', () => {
    expect(describeDue({ atMs: local(2026, 8, 25, 15), allDay: false }, at, 'en', words)).toMatch(
      /^Today, 3:00\sPM$/,
    );
    expect(describeDue({ atMs: local(2026, 8, 26), allDay: true }, at, 'en', words)).toBe(
      'Tomorrow',
    );
    expect(
      describeDue({ atMs: local(2026, 8, 24, 8, 30), allDay: false }, at, 'en', words),
    ).toMatch(/^Yesterday, 8:30\sAM$/);
  });

  it('spells other days as weekday and date, with the year once it differs', () => {
    expect(describeDue({ atMs: local(2026, 9, 5), allDay: true }, at, 'en', words)).toBe(
      'Mon, Oct 5',
    );
    expect(describeDue({ atMs: local(2027, 7, 7, 18), allDay: false }, at, 'en', words)).toMatch(
      /^Sat, Aug 7, 2027, 6:00\sPM$/,
    );
  });

  it('follows the locale', () => {
    expect(describeDue({ atMs: local(2026, 9, 5, 18), allDay: false }, at, 'de', words)).toBe(
      'Mo., 5. Okt., 18:00',
    );
  });

  it('marks a timed task overdue at its moment and an all-day one after its day', () => {
    expect(isOverdue({ atMs: at - 1, allDay: false }, at)).toBe(true);
    expect(isOverdue({ atMs: at + 1, allDay: false }, at)).toBe(false);
    expect(isOverdue({ atMs: local(2026, 8, 25), allDay: true }, at)).toBe(false);
    expect(isOverdue({ atMs: local(2026, 8, 24), allDay: true }, at)).toBe(true);
  });
});
