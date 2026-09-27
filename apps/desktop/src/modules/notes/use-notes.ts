import {
  commands,
  events,
  type IpcError,
  type Note,
  type NoteContent,
  type NoteDraft,
  type NotesCommand,
  type NotesSnapshot,
  type Result,
} from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useNotesStore } from './notes-store';

/**
 * Mirrors the Rust notes service into `useNotesStore` while the caller is mounted: one
 * `get_notes_snapshot` round trip (a rescan), then `NotesChanged` after every write.
 * Unlistens on unmount so a closed panel costs nothing (PRD performance budget).
 */
export function useNotesSubscription(): void {
  const setSnapshot = useNotesStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.notesChanged
      .listen((event) => {
        setSnapshot(event.payload.snapshot);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .getNotesSnapshot()
      .then((result) => {
        if (!disposed && result.status === 'ok') setSnapshot(result.data);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

/** Sends a `NotesCommand` (refresh, pin, delete) and applies the snapshot it returns. */
export function useNotesCommand(): (command: NotesCommand) => void {
  const setSnapshot = useNotesStore((store) => store.setSnapshot);
  return useCallback(
    (command: NotesCommand) => {
      void commands
        .notesCommand(command)
        .then((result) => {
          if (result.status === 'ok') setSnapshot(result.data);
        })
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        });
    },
    [setSnapshot],
  );
}

/** Why a note could not be opened or saved, by the IPC error code the Rust side maps to. */
export type NoteFailure = 'conflict' | 'unknown' | 'tooLarge' | 'emptyTitle' | 'failed';

export type NoteOutcome<T> = { status: 'ok'; data: T } | { status: 'error'; failure: NoteFailure };

const failureOf = (error: IpcError): NoteFailure => {
  switch (error.code) {
    case 'notes.conflict':
      return 'conflict';
    case 'notes.unknown':
      return 'unknown';
    case 'notes.tooLarge':
      return 'tooLarge';
    case 'notes.emptyTitle':
      return 'emptyTitle';
    default:
      return 'failed';
  }
};

const outcome = async <T>(call: () => Promise<Result<T, IpcError>>): Promise<NoteOutcome<T>> => {
  try {
    const result = await call();
    return result.status === 'ok'
      ? { status: 'ok', data: result.data }
      : { status: 'error', failure: failureOf(result.error) };
  } catch {
    // Outside Tauri (tests, Storybook) there is no folder.
    return { status: 'error', failure: 'failed' };
  }
};

/** A new empty note named after `title`, opened for the editor. */
export const createNote = (title: string): Promise<NoteOutcome<NoteContent>> =>
  outcome(() => commands.notesCreate(title));

/** The note's body and the modified time a later save sends back. */
export const openNote = (id: string): Promise<NoteOutcome<NoteContent>> =>
  outcome(() => commands.notesOpen(id));

/** *Inbox* for quick capture, created when it does not exist yet. */
export const openInbox = (): Promise<NoteOutcome<NoteContent>> =>
  outcome(() => commands.notesOpenInbox());

/**
 * Writes the draft; `conflict` when the file changed elsewhere since it was loaded, in which
 * case the editor reopens the note instead of overwriting the other app's edit.
 */
export const saveNote = (draft: NoteDraft): Promise<NoteOutcome<NoteContent>> =>
  outcome(() => commands.notesSave(draft));

/** Renames the file (made safe and unique); answers with the note under its new id. */
export const renameNote = (id: string, title: string): Promise<NoteOutcome<Note>> =>
  outcome(() => commands.notesRename(id, title));

/** Ids of the notes whose title or body contains `query`, newest first; none outside Tauri. */
export async function searchNotes(query: string): Promise<readonly string[]> {
  try {
    const result = await commands.notesSearch(query);
    return result.status === 'ok' ? result.data : [];
  } catch {
    return [];
  }
}

const fireAndForget = async (call: () => Promise<unknown>): Promise<void> => {
  try {
    await call();
  } catch {
    // Outside Tauri there is no shell to hand the file to.
  }
};

/** Shows the note in Explorer, through Rust. */
export const revealNote = (id: string): Promise<void> =>
  fireAndForget(() => commands.notesReveal(id));

/** Opens the note in its default app (a note too large for the editor goes here). */
export const openNoteExternally = (id: string): Promise<void> =>
  fireAndForget(() => commands.notesOpenExternal(id));

/** Opens the notes folder in Explorer. */
export const revealFolder = (): Promise<void> => fireAndForget(() => commands.notesRevealFolder());

/** The folder picker; `null` when dismissed or outside Tauri. */
export async function pickNotesFolder(title: string): Promise<string | null> {
  try {
    const result = await commands.notesPickFolder(title);
    return result.status === 'ok' ? result.data : null;
  } catch {
    return null;
  }
}

/** The list the panel shows for `query`: every note, or the hits in list order. */
export const visibleNotes = (
  snapshot: NotesSnapshot,
  hits: readonly string[] | null,
): readonly Note[] =>
  hits === null ? snapshot.notes : snapshot.notes.filter((note) => hits.includes(note.id));
