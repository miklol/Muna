import type { IpcError, Note, NotesSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useNotesStore } from './notes-store';
import { NotesWidget } from './widget';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  getNotesSnapshot: vi.fn<() => Promise<IpcResult<NotesSnapshot>>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getNotesSnapshot: ipc.getNotesSnapshot },
  events: { notesChanged: { listen: ipc.listen } },
}));

const NOW = new Date(2026, 8, 27, 10, 6);
const TODAY = new Date(2026, 8, 27, 9, 30).getTime();

const note = (overrides: Partial<Note> & Pick<Note, 'id' | 'title'>): Note => ({
  folder: '',
  excerpt: '',
  modifiedMs: TODAY,
  bytes: 10,
  pinned: false,
  ...overrides,
});

const snapshot = (notes: Note[], overrides: Partial<NotesSnapshot> = {}): NotesSnapshot => ({
  folder: 'C:\\notes',
  defaultFolder: true,
  notes,
  inboxId: null,
  problem: null,
  ...overrides,
});

const renderWidget = (span: 1 | 2 = 1) =>
  render(
    <I18nextProvider i18n={i18n}>
      <NotesWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });

describe('NotesWidget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    useNotesStore.setState({ snapshot: null, receivedAt: 0, quickNotePending: false });
    ipc.getNotesSnapshot.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the first pinned note with its first line', async () => {
    ipc.getNotesSnapshot.mockResolvedValue({
      status: 'ok',
      data: snapshot([
        note({ id: 'Groceries.md', title: 'Groceries', excerpt: 'milk, eggs', pinned: true }),
        note({ id: 'Later.md', title: 'Later', excerpt: 'newer but unpinned' }),
      ]),
    });
    renderWidget();
    await flush();
    const card = screen.getByRole('generic', { name: 'Notes' });
    expect(card).toHaveTextContent('Groceries');
    expect(card).toHaveTextContent('milk, eggs');
    expect(card).not.toHaveTextContent('Later');
    expect(screen.getByLabelText('Pinned')).toBeInTheDocument();
    expect(card).not.toHaveTextContent('Edited');
  });

  it('falls back to the newest note and adds when it changed on a wide card', async () => {
    ipc.getNotesSnapshot.mockResolvedValue({
      status: 'ok',
      data: snapshot([note({ id: 'Ideas.md', title: 'Ideas', excerpt: 'a thought' })]),
    });
    renderWidget(2);
    await flush();
    const card = screen.getByRole('generic', { name: 'Notes' });
    expect(card).toHaveTextContent('Ideas');
    expect(card).toHaveTextContent(/Edited 9:30\sAM/);
    expect(screen.queryByLabelText('Pinned')).not.toBeInTheDocument();
  });

  it('says to pin a note when there is none, and when the folder is away', async () => {
    ipc.getNotesSnapshot.mockResolvedValue({ status: 'ok', data: snapshot([]) });
    const view = renderWidget();
    await flush();
    expect(screen.getByText('Pin a note to keep it here')).toBeInTheDocument();
    view.unmount();

    useNotesStore.setState({ snapshot: null });
    ipc.getNotesSnapshot.mockResolvedValue({
      status: 'ok',
      data: snapshot([note({ id: 'Stale.md', title: 'Stale' })], { problem: 'unreadable' }),
    });
    renderWidget();
    await flush();
    expect(screen.getByText('The notes folder is not available')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
  });

  it('renders nothing before the first snapshot', () => {
    ipc.getNotesSnapshot.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWidget();
    expect(container).toBeEmptyDOMElement();
  });
});
