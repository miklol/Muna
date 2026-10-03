import type {
  IpcError,
  Note,
  NoteContent,
  NoteDraft,
  NotesCommand,
  NotesSnapshot,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useNotesStore } from './notes-store';
import { NotesPanel } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });
const refuse = <T,>(code: string): IpcResult<T> => ({
  status: 'error',
  error: { code, message: code },
});

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: NotesSnapshot }>[] = [];
  return {
    getNotesSnapshot: vi.fn<() => Promise<IpcResult<NotesSnapshot>>>(),
    notesCommand: vi.fn<(command: NotesCommand) => Promise<IpcResult<NotesSnapshot>>>(),
    notesCreate: vi.fn<(title: string) => Promise<IpcResult<NoteContent>>>(),
    notesOpen: vi.fn<(id: string) => Promise<IpcResult<NoteContent>>>(),
    notesOpenInbox: vi.fn<() => Promise<IpcResult<NoteContent>>>(),
    notesSave: vi.fn<(draft: NoteDraft) => Promise<IpcResult<NoteContent>>>(),
    notesRename: vi.fn<(id: string, title: string) => Promise<IpcResult<Note>>>(),
    notesSearch: vi.fn<(query: string) => Promise<IpcResult<string[]>>>(),
    notesReveal: vi.fn<(id: string) => Promise<IpcResult<null>>>(),
    notesOpenExternal: vi.fn<(id: string) => Promise<IpcResult<null>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: NotesSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: NotesSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getNotesSnapshot: ipc.getNotesSnapshot,
    notesCommand: ipc.notesCommand,
    notesCreate: ipc.notesCreate,
    notesOpen: ipc.notesOpen,
    notesOpenInbox: ipc.notesOpenInbox,
    notesSave: ipc.notesSave,
    notesRename: ipc.notesRename,
    notesSearch: ipc.notesSearch,
    notesReveal: ipc.notesReveal,
    notesOpenExternal: ipc.notesOpenExternal,
    openSettings: ipc.openSettings,
  },
  events: {
    notesChanged: { listen: ipc.listen },
  },
}));

const NOW = new Date(2026, 8, 27, 10, 6);
const TODAY = new Date(2026, 8, 27, 9, 30).getTime();
const LAST_WEEK = new Date(2026, 8, 20, 18, 0).getTime();

const note = (overrides: Partial<Note> & Pick<Note, 'id' | 'title'>): Note => ({
  folder: '',
  excerpt: '',
  modifiedMs: TODAY,
  bytes: 120,
  pinned: false,
  ...overrides,
});

const groceries = note({
  id: 'Groceries.md',
  title: 'Groceries',
  excerpt: 'milk, eggs, bread',
  pinned: true,
});
const meeting = note({
  id: 'work/Meeting.md',
  title: 'Meeting',
  folder: 'work',
  excerpt: 'Agenda for Monday',
  modifiedMs: LAST_WEEK,
});
const inbox = note({ id: 'Inbox.md', title: 'Inbox', excerpt: '', modifiedMs: LAST_WEEK });

const snapshot = (overrides: Partial<NotesSnapshot> = {}): NotesSnapshot => ({
  folder: 'C:\\Users\\sam\\AppData\\Roaming\\Muna\\notes',
  defaultFolder: true,
  notes: [groceries, meeting, inbox],
  inboxId: 'Inbox.md',
  problem: null,
  ...overrides,
});

const content = (overrides: Partial<NoteContent> & Pick<NoteContent, 'id'>): NoteContent => ({
  title: overrides.id.replace(/^.*\//, '').replace(/\.md$/, ''),
  body: '',
  modifiedMs: TODAY,
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <NotesPanel />
    </I18nextProvider>,
  );

const flush = (ms = 200) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const list = () => screen.getByRole('region', { name: 'Notes' });
const editor = (title: string) => screen.getByRole('region', { name: title });

describe('NotesPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useNotesStore.setState({ snapshot: null, receivedAt: 0, quickNotePending: false });
    ipc.getNotesSnapshot.mockReset().mockResolvedValue(ok(snapshot()));
    ipc.notesCommand.mockReset().mockResolvedValue(ok(snapshot()));
    ipc.notesCreate.mockReset();
    ipc.notesOpen.mockReset();
    ipc.notesOpenInbox.mockReset();
    ipc.notesSave.mockReset();
    ipc.notesRename.mockReset();
    ipc.notesSearch.mockReset().mockResolvedValue(ok([]));
    ipc.notesReveal.mockReset().mockResolvedValue(ok(null));
    ipc.notesOpenExternal.mockReset().mockResolvedValue(ok(null));
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled before the timers go real.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('subscribes on mount, lists pinned then newest with their excerpts, and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getNotesSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    const rows = within(list()).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Groceries');
    expect(rows[0]).toHaveTextContent('milk, eggs, bread');
    expect(rows[0]).toHaveAttribute('data-pinned');
    expect(within(rows[0]!).getByLabelText('Pinned')).toBeInTheDocument();
    expect(rows[0]).toHaveTextContent(/9:30\sAM/);
    expect(rows[1]).toHaveTextContent('Meeting');
    expect(rows[1]).toHaveTextContent('Sep 20');
    expect(rows[1]).not.toHaveAttribute('data-pinned');
    expect(rows[2]).toHaveTextContent('Inbox');
    expect(list()).toHaveTextContent('3 notes');

    view.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('searches the folder through Rust once the keystrokes settle and says when nothing matches', async () => {
    renderPanel();
    await flush();
    ipc.notesSearch.mockResolvedValue(ok(['work/Meeting.md']));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), {
      target: { value: 'agenda' },
    });
    await flush(100);
    expect(ipc.notesSearch).not.toHaveBeenCalled();
    await flush(100);
    expect(ipc.notesSearch).toHaveBeenCalledWith('agenda');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('Meeting');
    expect(list()).toHaveTextContent('1 note');

    ipc.notesSearch.mockResolvedValue(ok([]));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), {
      target: { value: 'zzz' },
    });
    await flush();
    expect(screen.getByText('No notes match')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), {
      target: { value: '' },
    });
    await flush();
    expect(within(list()).getAllByRole('listitem')).toHaveLength(3);
    expect(ipc.notesSearch).toHaveBeenCalledTimes(2);
  });

  it('creates a note from the title field and opens it with the caret in the text', async () => {
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    const field = screen.getByRole('textbox', { name: 'Title of the new note' });
    expect(field).toHaveFocus();

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(
      screen.queryByRole('textbox', { name: 'Title of the new note' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search notes' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New note' }));
    ipc.notesCreate.mockResolvedValue(ok(content({ id: 'Ideas.md', title: 'Ideas' })));
    const again = screen.getByRole('textbox', { name: 'Title of the new note' });
    fireEvent.change(again, { target: { value: '  Ideas ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await flush();
    expect(ipc.notesCreate).toHaveBeenCalledWith('Ideas');
    expect(editor('Ideas')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveFocus();
  });

  it('opens a note, autosaves 600 ms after the last keystroke with the loaded baseline, and saves on blur', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValue(
      ok(content({ id: 'Groceries.md', body: 'milk, eggs, bread', modifiedMs: TODAY })),
    );
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await flush();
    expect(ipc.notesOpen).toHaveBeenCalledWith('Groceries.md');
    const text = screen.getByRole('textbox', { name: 'Note text' });
    expect(text).toHaveValue('milk, eggs, bread');
    expect(screen.getByRole('status')).toHaveTextContent(/Edited 9:30\sAM/);
    expect(text).not.toHaveFocus();

    ipc.notesSave.mockResolvedValue(
      ok(
        content({ id: 'Groceries.md', body: 'milk, eggs, bread, jam', modifiedMs: TODAY + 5_000 }),
      ),
    );
    fireEvent.change(text, { target: { value: 'milk, eggs, bread, ' } });
    await flush(300);
    fireEvent.change(text, { target: { value: 'milk, eggs, bread, jam' } });
    await flush(300);
    expect(ipc.notesSave).not.toHaveBeenCalled();
    await flush(400);
    expect(ipc.notesSave).toHaveBeenCalledTimes(1);
    expect(ipc.notesSave).toHaveBeenCalledWith({
      id: 'Groceries.md',
      body: 'milk, eggs, bread, jam',
      baseModifiedMs: TODAY,
    });
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    // The next save carries the new baseline; blur writes without waiting for the timer.
    fireEvent.change(text, { target: { value: 'milk, eggs, bread, jam, tea' } });
    fireEvent.blur(text);
    await flush(50);
    expect(ipc.notesSave).toHaveBeenCalledTimes(2);
    expect(ipc.notesSave).toHaveBeenLastCalledWith({
      id: 'Groceries.md',
      body: 'milk, eggs, bread, jam, tea',
      baseModifiedMs: TODAY + 5_000,
    });
  });

  it('reloads the note instead of overwriting it when the file changed in another app', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValueOnce(ok(content({ id: 'Groceries.md', body: 'milk' })));
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await flush();
    const text = screen.getByRole('textbox', { name: 'Note text' });

    ipc.notesSave.mockResolvedValue(refuse('notes.conflict'));
    ipc.notesOpen.mockResolvedValueOnce(
      ok(
        content({
          id: 'Groceries.md',
          body: 'milk and eggs (from Obsidian)',
          modifiedMs: TODAY + 9_000,
        }),
      ),
    );
    fireEvent.change(text, { target: { value: 'milk, bread' } });
    await flush(700);
    expect(ipc.notesSave).toHaveBeenCalledTimes(1);
    expect(ipc.notesOpen).toHaveBeenCalledTimes(2);
    expect(text).toHaveValue('milk and eggs (from Obsidian)');
    expect(screen.getByRole('status')).toHaveTextContent(
      'This note changed in another app and was reloaded.',
    );

    // Writing again starts from the reloaded baseline.
    ipc.notesSave.mockResolvedValue(
      ok(
        content({
          id: 'Groceries.md',
          body: 'milk and eggs (from Obsidian), tea',
          modifiedMs: TODAY + 12_000,
        }),
      ),
    );
    fireEvent.change(text, { target: { value: 'milk and eggs (from Obsidian), tea' } });
    await flush(700);
    expect(ipc.notesSave).toHaveBeenLastCalledWith({
      id: 'Groceries.md',
      body: 'milk and eggs (from Obsidian), tea',
      baseModifiedMs: TODAY + 9_000,
    });
  });

  it('says when a save failed and keeps the text for the next try', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValue(ok(content({ id: 'Groceries.md', body: 'milk' })));
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await flush();
    const text = screen.getByRole('textbox', { name: 'Note text' });
    ipc.notesSave.mockResolvedValue(refuse('notes.io'));
    fireEvent.change(text, { target: { value: 'milk, bread' } });
    await flush(700);
    expect(screen.getByRole('status')).toHaveTextContent(
      'The note could not be saved. Check the folder and try again.',
    );
    expect(text).toHaveValue('milk, bread');
  });

  it('writes what is pending when the editor closes, and nothing after a delete', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValue(ok(content({ id: 'Groceries.md', body: 'milk' })));
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await flush();
    ipc.notesSave.mockResolvedValue(ok(content({ id: 'Groceries.md', body: 'milk, bread' })));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), {
      target: { value: 'milk, bread' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    await flush();
    expect(ipc.notesSave).toHaveBeenCalledTimes(1);
    expect(ipc.notesSave).toHaveBeenCalledWith({
      id: 'Groceries.md',
      body: 'milk, bread',
      baseModifiedMs: TODAY,
    });
    expect(list()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Meeting/ }));
    await flush();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), {
      target: { value: 'gone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move to Recycle Bin' }));
    await flush();
    expect(ipc.notesCommand).toHaveBeenCalledWith({ kind: 'delete', id: 'Groceries.md' });
    expect(ipc.notesSave).toHaveBeenCalledTimes(1);
    expect(list()).toBeInTheDocument();
  });

  it('pins, previews, renames and shows the note in Explorer from the editor header', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValue(
      ok(content({ id: 'work/Meeting.md', body: '# Agenda\n\n- [x] budget\n- [ ] hiring' })),
    );
    fireEvent.click(screen.getByRole('button', { name: /Meeting/ }));
    await flush();

    const pin = screen.getByRole('button', { name: 'Pin Meeting' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    ipc.notesCommand.mockResolvedValue(
      ok(snapshot({ notes: [groceries, { ...meeting, pinned: true }, inbox] })),
    );
    fireEvent.click(pin);
    await flush();
    expect(ipc.notesCommand).toHaveBeenCalledWith({
      kind: 'pin',
      id: 'work/Meeting.md',
      pinned: true,
    });
    expect(screen.getByRole('button', { name: 'Unpin Meeting' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.queryByRole('textbox', { name: 'Note text' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Agenda' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      '☑budget',
      '☐hiring',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: 'Note text' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show in Explorer' }));
    await flush();
    expect(ipc.notesReveal).toHaveBeenCalledWith('work/Meeting.md');

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const field = screen.getByRole('textbox', { name: 'Title' });
    expect(field).toHaveValue('Meeting');
    ipc.notesRename.mockResolvedValue(
      ok(note({ id: 'work/Standup.md', title: 'Standup', folder: 'work', pinned: true })),
    );
    fireEvent.change(field, { target: { value: 'Standup' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.notesRename).toHaveBeenCalledWith('work/Meeting.md', 'Standup');
    expect(editor('Standup')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Note text' })).toHaveValue(
      '# Agenda\n\n- [x] budget\n- [ ] hiring',
    );
  });

  it('opens Inbox with the caret at the end for the quick note action', async () => {
    renderPanel();
    await flush();
    ipc.notesOpenInbox.mockResolvedValue(ok(content({ id: 'Inbox.md', body: 'first thought' })));
    act(() => {
      useNotesStore.getState().requestQuickNote();
    });
    await flush();
    expect(ipc.notesOpenInbox).toHaveBeenCalledTimes(1);
    expect(useNotesStore.getState().quickNotePending).toBe(false);
    const text = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Note text' });
    expect(text).toHaveFocus();
    expect(text.selectionStart).toBe('first thought'.length);
    expect(editor('Inbox')).toBeInTheDocument();
  });

  it('offers to open a note too large for the editor in another app', async () => {
    renderPanel();
    await flush();
    ipc.notesOpen.mockResolvedValue(refuse('notes.tooLarge'));
    fireEvent.click(screen.getByRole('button', { name: /Groceries/ }));
    await flush();
    expect(screen.getByText('Too large to edit here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open in another app' }));
    await flush();
    expect(ipc.notesOpenExternal).toHaveBeenCalledWith('Groceries.md');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the list' }));
    expect(list()).toBeInTheDocument();
  });

  it('says what to do when the folder is missing, and when there are no notes yet', async () => {
    ipc.getNotesSnapshot.mockResolvedValue(
      ok(snapshot({ folder: 'E:\\Vault', defaultFolder: false, notes: [], problem: 'missing' })),
    );
    const view = renderPanel();
    await flush();
    expect(screen.getByText('The notes folder is missing')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Vault cannot be found. Plug the drive back in, or choose another folder in Settings.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await flush();
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
    view.unmount();

    act(() => {
      ipc.emit(snapshot({ notes: [] }));
    });
    ipc.getNotesSnapshot.mockResolvedValue(ok(snapshot({ notes: [] })));
    renderPanel();
    await flush();
    expect(screen.getByText('No notes yet')).toBeInTheDocument();
    expect(list()).toHaveTextContent('0 notes');
  });

  it('follows NotesChanged while open', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(snapshot({ notes: [groceries] }));
    });
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(list()).toHaveTextContent('1 note');
  });
});
