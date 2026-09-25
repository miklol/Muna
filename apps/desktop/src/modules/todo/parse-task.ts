import type { TaskDue } from '@muna/contracts';
import { casual } from 'chrono-node/en';

export interface ParsedTask {
  /** The typed text without the date phrase, or the whole text when nothing parsed. */
  title: string;
  due: TaskDue | null;
  /** The phrase the parser consumed, for the preview chip; `null` without a due. */
  phrase: string | null;
}

/**
 * Words that only introduced the date phrase ("report by next monday", "rent on Friday") and
 * would dangle once it is removed. Stripped repeatedly from the end of the title.
 */
const CONNECTOR = /\s*\b(?:at|on|by|due|for|until|till|before|the)\s*$/i;

/** Punctuation that only separated a leading date phrase from the title ("Tomorrow: call Sam"). */
const LEADING_SEPARATOR = /^[\s:,;–—-]+/;

const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

const withoutPhrase = (input: string, index: number, phrase: string): string => {
  let before = input.slice(0, index);
  let previous: string;
  do {
    previous = before;
    before = before.replace(CONNECTOR, '');
  } while (before !== previous);
  const after = input.slice(index + phrase.length).replace(LEADING_SEPARATOR, ' ');
  return tidy(`${before} ${after}`);
};

/**
 * Splits what the user typed into a title and a due date (docs/modules/todo.md, "Add"): "Call
 * Sam tomorrow 3pm" → title "Call Sam", due tomorrow 15:00 in the local time zone. A phrase
 * without a time ("Pay rent on Friday") is an all-day task due at local midnight of that day.
 * Dates always resolve forward, so "Friday" on a Saturday means next week. When the date is
 * all there is, the text stays the title and nothing is due. Only the English grammar ships
 * for now; other locales join when the catalog gets them.
 */
export function parseTask(input: string, now: Date = new Date()): ParsedTask {
  const text = tidy(input);
  const first = casual.parse(text, now, { forwardDate: true })[0];
  if (first === undefined) {
    return { title: text, due: null, phrase: null };
  }
  const title = withoutPhrase(text, first.index, first.text);
  if (title === '') {
    return { title: text, due: null, phrase: null };
  }
  const moment = first.start.date();
  const allDay = !first.start.isCertain('hour');
  const atMs = allDay
    ? new Date(moment.getFullYear(), moment.getMonth(), moment.getDate()).getTime()
    : moment.getTime();
  return { title, due: { atMs, allDay }, phrase: first.text };
}
