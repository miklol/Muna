/**
 * The drop row with the real springs and the shell's IPC faked. Motion binds its frame loop
 * to `requestAnimationFrame` when it loads, so the fake clock is installed before any import:
 * the target's pulse then settles inside `settle()`.
 */
vi.hoisted(() => {
  vi.useFakeTimers();
});

import type * as Contracts from '@muna/contracts';
import {
  type DropAction,
  type DropItem,
  type DropPoint,
  defaultDropActionsSettings,
  defaultSettings,
  writeDropActionsSettings,
} from '@muna/contracts';
import { MunaMotionProvider } from '@muna/ui/motion';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings } from '../../lib/settings';
import { DropSurface, measureTiles } from './drop-surface';

const ipc = vi.hoisted(() => {
  const ok = () => Promise.resolve({ status: 'ok' as const, data: null });
  return {
    dropRun: vi.fn<(session: number, action: DropAction) => Promise<unknown>>(ok),
    dropCancel: vi.fn<(session: number) => Promise<unknown>>(ok),
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { dropRun: ipc.dropRun, dropCancel: ipc.dropCancel },
  events: {},
}));

const TILE = { width: 156, height: 96, gap: 12 };
/** Client x of the tile at `index` in document order, plus a little. */
const overTile = (index: number, y = 20): DropPoint => ({
  x: index * (TILE.width + TILE.gap) + 10,
  y,
});
const NOWHERE: DropPoint = { x: 5000, y: 5000 };
const AWAY: DropPoint = { x: -1, y: -1 };

const pdf: DropItem = { name: 'report.pdf', extension: 'pdf', isDirectory: false };
const zip: DropItem = { name: 'bundle.zip', extension: 'zip', isDirectory: false };

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const settle = () => advance(2000);

describe('DropSurface', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.dropRun.mockClear();
    ipc.dropCancel.mockClear();
    // Tiles sit in one long row of 156 × 96 boxes, 12 apart, in document order.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const key = this.getAttribute('data-tile-key');
      const tiles = Array.from(document.querySelectorAll('[data-tile-key]'));
      const index = key === null ? -1 : tiles.indexOf(this);
      const left = index < 0 ? 0 : index * (TILE.width + TILE.gap);
      const width = index < 0 ? 0 : TILE.width;
      const height = index < 0 ? 0 : TILE.height;
      return {
        x: left,
        y: 0,
        left,
        top: 0,
        width,
        height,
        right: left + width,
        bottom: height,
        toJSON: () => ({}),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  interface Props {
    readonly session?: number;
    readonly items?: readonly DropItem[];
    readonly position?: DropPoint;
    readonly dropped?: boolean;
    readonly reduceMotion?: boolean;
    readonly onDone?: () => void;
  }

  const renderRow = ({
    session = 1,
    items = [pdf, { ...pdf, name: 'notes.txt', extension: 'txt' }],
    position = AWAY,
    dropped = false,
    reduceMotion = false,
    onDone = vi.fn(),
  }: Props = {}) => {
    const ui = (next: Partial<Props>) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MunaMotionProvider reduceMotion={reduceMotion}>
            <DropSurface
              session={session}
              items={items}
              position={next.position ?? position}
              dropped={next.dropped ?? dropped}
              maxWidth={1000}
              onDone={onDone}
            />
          </MunaMotionProvider>
        </QueryClientProvider>
      </I18nextProvider>
    );
    const view = render(ui({}));
    return {
      onDone,
      move: (to: DropPoint) => {
        act(() => {
          view.rerender(ui({ position: to }));
        });
      },
      release: (at: DropPoint) => {
        act(() => {
          view.rerender(ui({ position: at, dropped: true }));
        });
      },
    };
  };

  const tiles = () => screen.getAllByRole('group').flatMap((group) => measureTiles(group));
  const tile = (key: string) => {
    const node = screen.getByRole('group').querySelector(`[data-tile-key="${key}"]`);
    if (!(node instanceof HTMLElement)) {
      throw new Error(`no tile ${key}`);
    }
    return node;
  };

  it('shows three tiles and More, named for the items, and dims a tile the items cannot use', () => {
    renderRow();
    const group = screen.getByRole('group', { name: 'Drop 2 items on an action' });
    expect(group).toHaveStyle({ maxWidth: '1000px' });
    expect(tiles().map((rect) => rect.key)).toEqual(['nearbyShare', 'copyTo', 'moveTo', 'more']);
    expect(within(group).getByText('Nearby Share')).toBeInTheDocument();
    expect(within(group).getByText('6 more tiles')).toBeInTheDocument();
    expect(within(group).queryByRole('separator')).toBeNull();
  });

  it('highlights the tile under the drag, only when it is enabled, and clears when the drag leaves', () => {
    cacheSettings(
      queryClient,
      writeDropActionsSettings(defaultSettings(), {
        ...defaultDropActionsSettings(),
        tiles: [{ kind: 'nearbyShare' }, { kind: 'divider' }, { kind: 'unzip' }, { kind: 'zip' }],
      }),
    );
    const row = renderRow();
    expect(tiles().map((rect) => rect.key)).toEqual(['nearbyShare', 'unzip', 'zip']);
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(tile('unzip')).toHaveAttribute('aria-disabled', 'true');

    row.move(overTile(0));
    expect(tile('nearbyShare')).toHaveAttribute('data-hovered');
    row.move(overTile(1));
    expect(tile('nearbyShare')).not.toHaveAttribute('data-hovered');
    expect(tile('unzip')).not.toHaveAttribute('data-hovered');
    row.move(overTile(2));
    expect(tile('zip')).toHaveAttribute('data-hovered');
    row.move(NOWHERE);
    expect(screen.getByRole('group').querySelector('[data-hovered]')).toBeNull();
  });

  it('reveals the hidden rows when the drag reaches More; eight tiles per row when the notch expands', () => {
    const row = renderRow();
    row.move(overTile(3));
    expect(tiles().map((rect) => rect.key)).toEqual([
      'nearbyShare',
      'copyTo',
      'moveTo',
      'openWith',
      'zip',
      'unzip',
      'reveal',
      'trash',
      'eject',
    ]);
    expect(screen.getByRole('group').querySelectorAll('.drop-row')).toHaveLength(3);
    row.move(NOWHERE);
    expect(tiles()).toHaveLength(9);

    cacheSettings(
      queryClient,
      writeDropActionsSettings(defaultSettings(), {
        ...defaultDropActionsSettings(),
        expandNotch: true,
      }),
    );
    row.move(AWAY);
    expect(tiles()).toHaveLength(9);
    expect(screen.getByRole('group').querySelectorAll('.drop-row')).toHaveLength(2);
  });

  it('runs the tile under the release and hands the notch back after one pulse', async () => {
    const row = renderRow({ session: 7 });
    row.move(overTile(1));
    row.release(overTile(1));
    expect(ipc.dropRun).toHaveBeenCalledTimes(1);
    expect(ipc.dropRun).toHaveBeenLastCalledWith(7, { kind: 'copyTo', title: 'Copy to' });
    expect(ipc.dropCancel).not.toHaveBeenCalled();
    expect(row.onDone).not.toHaveBeenCalled();
    expect(tile('copyTo')).toHaveAttribute('data-hovered');
    await settle();
    expect(row.onDone).toHaveBeenCalledTimes(1);
    // A second render with the drop still set runs nothing twice.
    row.release(overTile(0));
    expect(ipc.dropRun).toHaveBeenCalledTimes(1);
  });

  it('hands the notch back at once under reduced motion', () => {
    const row = renderRow({ session: 8, items: [zip], reduceMotion: true });
    row.move(overTile(3));
    row.release(overTile(5));
    expect(ipc.dropRun).toHaveBeenLastCalledWith(8, { kind: 'unzip' });
    expect(row.onDone).toHaveBeenCalledTimes(1);
  });

  it('forgets the items when the release lands on nothing, on More or on a dimmed tile', () => {
    const nowhere = renderRow({ session: 9 });
    nowhere.release(NOWHERE);
    expect(ipc.dropCancel).toHaveBeenLastCalledWith(9);
    expect(nowhere.onDone).toHaveBeenCalledTimes(1);
    expect(ipc.dropRun).not.toHaveBeenCalled();
  });

  it('a release on More reveals nothing and cancels', () => {
    const row = renderRow({ session: 10 });
    row.release(overTile(3));
    expect(ipc.dropCancel).toHaveBeenLastCalledWith(10);
    expect(row.onDone).toHaveBeenCalledTimes(1);
    expect(ipc.dropRun).not.toHaveBeenCalled();
  });

  it('a release on a dimmed Unzip cancels', () => {
    cacheSettings(
      queryClient,
      writeDropActionsSettings(defaultSettings(), {
        ...defaultDropActionsSettings(),
        tiles: [{ kind: 'unzip' }],
      }),
    );
    const row = renderRow({ session: 11 });
    row.release(overTile(0));
    expect(ipc.dropCancel).toHaveBeenLastCalledWith(11);
    expect(row.onDone).toHaveBeenCalledTimes(1);
    expect(ipc.dropRun).not.toHaveBeenCalled();
  });

  it('measures nothing without a root', () => {
    expect(measureTiles(null)).toEqual([]);
  });
});
