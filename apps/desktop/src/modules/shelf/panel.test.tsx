import type { ShelfCommand, ShelfItem, ShelfSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { ShelfPanel } from './panel';
import { formatSize, isLink, orderedItems, targetIds, useShelfStore } from './shelf-store';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: ShelfSnapshot }>[] = [];
  return {
    getShelfSnapshot: vi.fn<() => Promise<IpcResult<ShelfSnapshot>>>(),
    shelfCommand: vi.fn<(command: ShelfCommand) => Promise<IpcResult<ShelfSnapshot>>>(),
    shelfThumbnail: vi.fn<(id: string) => Promise<IpcResult<string | null>>>(),
    dragOut: vi.fn(),
    listen: vi.fn((callback: Listener<{ snapshot: ShelfSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: ShelfSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getShelfSnapshot: ipc.getShelfSnapshot,
    shelfCommand: ipc.shelfCommand,
    shelfThumbnail: ipc.shelfThumbnail,
    dragOut: ipc.dragOut,
  },
  events: {
    shelfChanged: { listen: ipc.listen },
  },
}));

const NOW = 1_770_000_000_000;
/** A 1 × 1 transparent PNG, the shape of what Rust hands back. */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let nextId = 0;
const file = (overrides: Partial<ShelfItem> & { name: string }): ShelfItem => ({
  id: `s${String(++nextId)}`,
  kind: 'file',
  extension: overrides.name.includes('.') ? (overrides.name.split('.').pop() ?? null) : null,
  size: 2_048,
  isFolder: false,
  copied: false,
  missing: false,
  preview: null,
  addedAtMs: NOW - nextId * 1_000,
  ...overrides,
});
const snippet = (text: string, addedAtMs?: number): ShelfItem => ({
  id: `s${String(++nextId)}`,
  kind: 'text',
  name: text.split('\n')[0] ?? text,
  extension: null,
  size: null,
  isFolder: false,
  copied: false,
  missing: false,
  preview: text,
  addedAtMs: addedAtMs ?? NOW - nextId * 1_000,
});

const snapshot = (items: ShelfItem[]): ShelfSnapshot => ({
  items,
  settings: { copyIntoStorage: false, expiryDays: 0 },
});

const ok = <T,>(data: T): IpcResult<T> => ({ status: 'ok', data });

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <ShelfPanel />
      </QueryClientProvider>
    </I18nextProvider>,
  );

/** Lets the snapshot promise settle and any leaving tile finish its exit. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

const tileNames = () =>
  screen.getAllByRole('option').map((tile) => tile.getAttribute('aria-label'));

describe('shelf store helpers', () => {
  it('orders items newest first and works on the selection or the pressed tile', () => {
    const items = [
      file({ name: 'old.pdf', addedAtMs: 1 }),
      file({ name: 'new.pdf', addedAtMs: 3 }),
      file({ name: 'mid.pdf', addedAtMs: 2 }),
    ];
    expect(orderedItems(items).map((item) => item.name)).toEqual(['new.pdf', 'mid.pdf', 'old.pdf']);
    expect(targetIds(['a', 'b'], 'a')).toEqual(['a', 'b']);
    expect(targetIds(['a', 'b'], 'c')).toEqual(['c']);
    expect(targetIds(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('tells links from text and formats sizes in the locale', () => {
    expect(isLink('https://example.com/a?b=1')).toBe(true);
    expect(isLink(' http://example.com ')).toBe(true);
    expect(isLink('see https://example.com')).toBe(false);
    expect(isLink(null)).toBe(false);
    expect(formatSize(null, 'en-US')).toBeNull();
    expect(formatSize(512, 'en-US')).toBe('512 byte');
    expect(formatSize(2_048, 'en-US')).toBe('2 kB');
    expect(formatSize(1_234_567, 'en-US')).toBe('1.2 MB');
  });

  it('prunes the selection when an item leaves the snapshot', () => {
    useShelfStore.setState({ snapshot: null, selected: ['a', 'b'] });
    useShelfStore.getState().setSnapshot(snapshot([file({ id: 'a', name: 'a.txt' })]));
    expect(useShelfStore.getState().selected).toEqual(['a']);
    useShelfStore.getState().toggle('a');
    expect(useShelfStore.getState().selected).toEqual([]);
  });
});

describe('ShelfPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    nextId = 0;
    useShelfStore.setState({ snapshot: null, selected: [] });
    ipc.getShelfSnapshot.mockReset().mockResolvedValue(ok(snapshot([])));
    ipc.shelfCommand.mockReset().mockImplementation(() => Promise.resolve(ok(snapshot([]))));
    ipc.shelfThumbnail.mockReset().mockResolvedValue(ok(null));
    ipc.dragOut.mockReset();
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled, or the dropped fake frame would leave
    // it waiting forever and the next test's exit animations would never finish.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  it('subscribes once, shows the empty state and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getShelfSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);
    expect(screen.getByText('Nothing on the Shelf yet')).toBeInTheDocument();
    expect(screen.getByText('0 items')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    view.unmount();
    expect(ipc.listenerCount()).toBe(0);
  });

  it('lists items newest first with thumbnails, placeholders and the missing state', async () => {
    const pdf = file({ name: 'report.pdf', addedAtMs: NOW - 3_000 });
    const gone = file({ name: 'gone.docx', missing: true, addedAtMs: NOW - 2_000 });
    const link = snippet('https://example.com', NOW - 1_000);
    const folder = file({ name: 'Photos', isFolder: true, size: null, addedAtMs: NOW - 4_000 });
    ipc.getShelfSnapshot.mockResolvedValue(ok(snapshot([pdf, gone, folder, link])));
    ipc.shelfThumbnail.mockImplementation((id) => Promise.resolve(ok(id === pdf.id ? PNG : null)));
    renderPanel();
    await flush();
    expect(tileNames()).toEqual(['https://example.com', 'gone.docx', 'report.pdf', 'Photos']);
    expect(screen.getByText('4 items')).toBeInTheDocument();
    const list = screen.getByRole('listbox', { name: 'Shelf' });
    expect(list.querySelector('img')).toHaveAttribute('src', PNG);
    expect(screen.getByRole('option', { name: 'gone.docx' })).toHaveAttribute(
      'data-missing',
      'true',
    );
    expect(screen.getByRole('option', { name: 'gone.docx' })).toHaveAttribute(
      'title',
      'File not found',
    );
    expect(screen.getByRole('option', { name: 'report.pdf' })).toHaveAttribute('title', '2 kB');
    expect(screen.getByRole('option', { name: 'Photos' })).toHaveAttribute('title', 'Folder');
    expect(screen.getByRole('button', { name: 'Remove 1 missing' })).toBeInTheDocument();
    // Thumbnails are asked for files that exist, never for snippets or missing files.
    const asked = ipc.shelfThumbnail.mock.calls.map(([id]) => id).sort();
    expect(asked).toEqual([pdf.id, folder.id].sort());
  });

  it('adds a snippet from the paste field and clears it once Rust accepts', async () => {
    const added = snippet('https://example.com');
    ipc.shelfCommand.mockResolvedValue(ok(snapshot([added])));
    renderPanel();
    await flush();
    const field = screen.getByRole('textbox', { name: 'Paste text or a link, then Enter' });
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(ipc.shelfCommand).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'https://example.com' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.shelfCommand).toHaveBeenCalledWith({ kind: 'addText', text: 'https://example.com' });
    expect(field).toHaveValue('');
    expect(tileNames()).toEqual(['https://example.com']);
  });

  it('selects by click, select-all and the keyboard, and removes the selection', async () => {
    const a = file({ name: 'a.pdf', addedAtMs: NOW - 1_000 });
    const b = file({ name: 'b.pdf', addedAtMs: NOW - 2_000 });
    const c = file({ name: 'c.pdf', addedAtMs: NOW - 3_000 });
    ipc.getShelfSnapshot.mockResolvedValue(ok(snapshot([a, b, c])));
    ipc.shelfCommand.mockResolvedValue(ok(snapshot([c])));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('option', { name: 'a.pdf' }));
    expect(screen.getByRole('option', { name: 'a.pdf' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show in Explorer' })).toBeInTheDocument();

    const list = screen.getByRole('listbox', { name: 'Shelf' });
    screen.getByRole('option', { name: 'a.pdf' }).focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    fireEvent.keyDown(list, { key: ' ' });
    expect(screen.getByRole('option', { name: 'b.pdf' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('3 items')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('option', { name: 'a.pdf' }));
    fireEvent.click(screen.getByRole('option', { name: 'b.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove 2 items' }));
    await flush();
    expect(ipc.shelfCommand).toHaveBeenCalledWith({ kind: 'remove', ids: [a.id, b.id] });
    expect(tileNames()).toEqual(['c.pdf']);
    expect(useShelfStore.getState().selected).toEqual([]);
  });

  it('copies, opens, reveals and clears through the commands', async () => {
    const a = file({ name: 'a.pdf', addedAtMs: NOW - 1_000 });
    const gone = file({ name: 'gone.pdf', missing: true, addedAtMs: NOW - 2_000 });
    ipc.getShelfSnapshot.mockResolvedValue(ok(snapshot([a, gone])));
    ipc.shelfCommand.mockImplementation((command) =>
      Promise.resolve(ok(snapshot(command.kind === 'clear' ? [] : [a, gone]))),
    );
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Copy everything to the clipboard' }));
    await flush();
    // Missing files have nothing to put on the clipboard; only the present one goes.
    expect(ipc.shelfCommand).toHaveBeenLastCalledWith({ kind: 'copy', ids: [a.id] });
    expect(screen.getByText('Copied to the clipboard')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(screen.getByText('2 items')).toBeInTheDocument();

    fireEvent.doubleClick(screen.getByRole('option', { name: 'a.pdf' }));
    expect(ipc.shelfCommand).toHaveBeenLastCalledWith({ kind: 'open', id: a.id });
    fireEvent.doubleClick(screen.getByRole('option', { name: 'gone.pdf' }));
    expect(ipc.shelfCommand).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('option', { name: 'a.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show in Explorer' }));
    expect(ipc.shelfCommand).toHaveBeenLastCalledWith({ kind: 'reveal', ids: [a.id] });

    fireEvent.click(screen.getByRole('button', { name: 'Remove 1 missing' }));
    expect(ipc.shelfCommand).toHaveBeenLastCalledWith({ kind: 'removeMissing' });

    // A second click deselects; with nothing selected the trash button clears the whole Shelf.
    fireEvent.click(screen.getByRole('option', { name: 'a.pdf' }));
    expect(screen.getByText('2 items')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the Shelf' }));
    await flush();
    expect(ipc.shelfCommand).toHaveBeenLastCalledWith({ kind: 'clear' });
    expect(screen.getByText('Nothing on the Shelf yet')).toBeInTheDocument();
  });

  it('starts an OLE drag of the selection when a selected tile is dragged, else of the tile', async () => {
    const a = file({ name: 'a.pdf', addedAtMs: NOW - 1_000 });
    const b = file({ name: 'b.pdf', addedAtMs: NOW - 2_000 });
    const c = file({ name: 'c.pdf', addedAtMs: NOW - 3_000 });
    ipc.getShelfSnapshot.mockResolvedValue(ok(snapshot([a, b, c])));
    ipc.dragOut.mockResolvedValue(ok({ kind: 'cancelled' }));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('option', { name: 'a.pdf' }));
    fireEvent.click(screen.getByRole('option', { name: 'b.pdf' }));

    const drag = (name: string) => {
      const tile = screen.getByRole('option', { name });
      fireEvent.pointerDown(tile, { button: 0, buttons: 1, clientX: 10, clientY: 10 });
      fireEvent.pointerMove(tile, { buttons: 1, clientX: 30, clientY: 10 });
    };
    drag('a.pdf');
    expect(ipc.dragOut).toHaveBeenLastCalledWith({ kind: 'shelf', ids: [a.id, b.id] });
    await flush();
    drag('c.pdf');
    expect(ipc.dragOut).toHaveBeenLastCalledWith({ kind: 'shelf', ids: [c.id] });
  });

  it('follows ShelfChanged events while mounted', async () => {
    renderPanel();
    await flush();
    act(() => {
      ipc.emit(snapshot([snippet('a note')]));
    });
    expect(tileNames()).toEqual(['a note']);
    expect(within(screen.getByRole('listbox')).getByRole('option')).toHaveAttribute(
      'title',
      'a note',
    );
  });
});
