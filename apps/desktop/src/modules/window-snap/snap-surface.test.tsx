import type * as Contracts from '@muna/contracts';
import {
  type DropPoint,
  type SnapZoneRef,
  defaultSettings,
  defaultWindowSnapSettings,
  writeWindowSnapSettings,
} from '@muna/contracts';
import { MunaMotionProvider } from '@muna/ui/motion';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings } from '../../lib/settings';
import { SnapSurface } from './snap-surface';
import { measureTiles } from './zones';

const ipc = vi.hoisted(() => {
  const ok = () => Promise.resolve({ status: 'ok' as const, data: null });
  return {
    snapApply: vi.fn<(session: number, label: string, zone: SnapZoneRef) => Promise<unknown>>(ok),
    snapCancel: vi.fn<(session: number) => Promise<boolean>>(() => Promise.resolve(true)),
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { snapApply: ipc.snapApply, snapCancel: ipc.snapCancel },
  events: {},
}));

const TILE = { width: 76, height: 64, gap: 4 };
/** Client x of the tile at `index` in document order, plus a little. */
const overTile = (index: number, y = 20): DropPoint => ({
  x: index * (TILE.width + TILE.gap) + 10,
  y,
});
const NOWHERE: DropPoint = { x: 5000, y: 5000 };
const AWAY: DropPoint = { x: -1, y: -1 };

describe('SnapSurface', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.snapApply.mockClear();
    ipc.snapCancel.mockClear();
    // jsdom lays nothing out: tiles sit in one row of 76 × 64 boxes, 4 apart, in document order.
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
    readonly position?: DropPoint;
    readonly ended?: boolean;
    readonly onDone?: () => void;
  }

  const renderZones = ({
    session = 1,
    position = AWAY,
    ended = false,
    onDone = vi.fn(),
  }: Props = {}) => {
    const ui = (next: Partial<Props>) => (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <MunaMotionProvider reduceMotion={false}>
            <SnapSurface
              session={session}
              position={next.position ?? position}
              ended={next.ended ?? ended}
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
          view.rerender(ui({ position: at, ended: true }));
        });
      },
    };
  };

  const keys = () => measureTiles(screen.getByRole('group')).map((rect) => rect.key);
  const tile = (key: string) => {
    const node = screen.getByRole('group').querySelector(`[data-tile-key="${key}"]`);
    if (!(node instanceof HTMLElement)) {
      throw new Error(`no tile ${key}`);
    }
    return node;
  };

  it('shows one tile per enabled zone, named and drawn, inside the width it is given', () => {
    renderZones();
    const group = screen.getByRole('group', { name: 'Snap zones' });
    expect(group).toHaveStyle({ maxWidth: '1000px' });
    expect(group.style.gridTemplateColumns).toBe('repeat(10, minmax(0, 1fr))');
    expect(keys()).toHaveLength(10);
    expect(keys()[0]).toBe('builtIn:topLeft');
    expect(within(group).getByText('Left half')).toBeInTheDocument();
    expect(within(group).getByText('Maximise')).toBeInTheDocument();
    expect(within(group).getByText('Centre third')).toBeInTheDocument();
    expect(tile('builtIn:maximize')).toHaveAttribute('aria-label', 'Maximise');
    expect(tile('builtIn:maximize').querySelector('svg')).not.toBeNull();
    expect(group.querySelector('[data-hovered]')).toBeNull();
  });

  it('follows the settings: chosen zones first, then the grid cells', () => {
    cacheSettings(
      queryClient,
      writeWindowSnapSettings(defaultSettings(), {
        ...defaultWindowSnapSettings(),
        zones: ['leftHalf', 'rightHalf'],
        grid: { rows: 1, cols: 2, gap: 8 },
      }),
    );
    renderZones();
    expect(keys()).toEqual(['builtIn:leftHalf', 'builtIn:rightHalf', 'cell:0:0', 'cell:0:1']);
    expect(screen.getByText('Cell 1, 2')).toBeInTheDocument();
    expect(screen.getByRole('group').style.gridTemplateColumns).toBe('repeat(4, minmax(0, 1fr))');
  });

  it('tints the tile under the drag and clears it when the drag is between or off the tiles', () => {
    const zones = renderZones();
    zones.move(overTile(0));
    expect(tile('builtIn:topLeft')).toHaveAttribute('data-hovered');
    zones.move(overTile(3));
    expect(tile('builtIn:topLeft')).not.toHaveAttribute('data-hovered');
    expect(tile('builtIn:maximize')).toHaveAttribute('data-hovered');
    zones.move({ x: TILE.width + 1, y: 20 });
    expect(screen.getByRole('group').querySelector('[data-hovered]')).toBeNull();
    zones.move(NOWHERE);
    expect(screen.getByRole('group').querySelector('[data-hovered]')).toBeNull();
  });

  it('applies the tile under the release once and hands the notch back', () => {
    const zones = renderZones({ session: 7 });
    zones.move(overTile(2));
    zones.release(overTile(2));
    expect(ipc.snapApply).toHaveBeenCalledTimes(1);
    expect(ipc.snapApply).toHaveBeenLastCalledWith(7, 'notch', { builtIn: 'leftHalf' });
    expect(ipc.snapCancel).not.toHaveBeenCalled();
    expect(zones.onDone).toHaveBeenCalledTimes(1);
    expect(tile('builtIn:leftHalf')).toHaveAttribute('data-hovered');
    // A second render with the drag still ended applies nothing twice.
    zones.release(overTile(0));
    expect(ipc.snapApply).toHaveBeenCalledTimes(1);
    expect(zones.onDone).toHaveBeenCalledTimes(1);
  });

  it('applies a grid cell by its row and column', () => {
    cacheSettings(
      queryClient,
      writeWindowSnapSettings(defaultSettings(), {
        ...defaultWindowSnapSettings(),
        zones: [],
        grid: { rows: 2, cols: 2, gap: 8 },
      }),
    );
    const zones = renderZones({ session: 8 });
    zones.release(overTile(3));
    expect(ipc.snapApply).toHaveBeenLastCalledWith(8, 'notch', { cell: { row: 1, col: 1 } });
    expect(zones.onDone).toHaveBeenCalledTimes(1);
  });

  it('cancels the session when the release lands on no tile', () => {
    const zones = renderZones({ session: 9 });
    zones.release(NOWHERE);
    expect(ipc.snapCancel).toHaveBeenCalledTimes(1);
    expect(ipc.snapCancel).toHaveBeenLastCalledWith(9);
    expect(ipc.snapApply).not.toHaveBeenCalled();
    expect(zones.onDone).toHaveBeenCalledTimes(1);
  });
});
