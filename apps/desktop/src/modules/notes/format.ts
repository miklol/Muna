import type { Note, NotesSnapshot } from '@muna/contracts';

const DAY_MS = 86_400_000;

/**
 * When a note last changed, as the list rows say it: the time of day for today, `Mar 4` for
 * this year, `Mar 4, 2023` before that. `now` comes from the caller so the words are testable.
 */
export const formatModified = (ms: number, now: number, locale: string): string => {
  const then = new Date(ms);
  const today = new Date(now);
  const sameDay =
    then.getFullYear() === today.getFullYear() &&
    then.getMonth() === today.getMonth() &&
    then.getDate() === today.getDate();
  if (sameDay || now - ms < DAY_MS / 2) {
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms);
  }
  const sameYear = then.getFullYear() === today.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(ms);
};

/** The last path segment of the notes folder — what the settings row shows in bold. */
export const folderDisplayName = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/]/).pop();
  return last === undefined || last === '' ? trimmed : last;
};

/** The note the editor shows, from the list, so pins and the folder follow renames. */
export const noteById = (snapshot: NotesSnapshot | null, id: string): Note | undefined =>
  snapshot?.notes.find((note) => note.id === id);
