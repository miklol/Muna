import type { ShellLayout } from '@muna/contracts';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '../app-providers';
import { useAppStore } from '../store/app-store';
import { NotchWindow } from './notch-window';

type Listener<T> = (event: { payload: T }) => void;
interface YieldPayload {
  label: string;
  state: ShellLayout['yieldState'];
}

const { listeners, commands } = vi.hoisted(() => ({
  listeners: {
    layout: [] as Listener<{ layout: ShellLayout }>[],
    yield: [] as Listener<YieldPayload>[],
  },
  commands: {
    getShellLayout: vi.fn(() => Promise.resolve({ status: 'ok' as const, data: null })),
    shellReady: vi.fn(() => Promise.resolve({ status: 'ok' as const, data: null })),
    publishShapeRects: vi.fn((_rects: unknown[]) =>
      Promise.resolve({ status: 'ok' as const, data: null }),
    ),
  },
}));

vi.mock('@muna/contracts', () => ({
  commands,
  events: {
    stripContentChanged: { listen: vi.fn(() => Promise.resolve(() => undefined)) },
    shellLayoutChanged: {
      listen: vi.fn((cb: Listener<{ layout: ShellLayout }>) => {
        listeners.layout.push(cb);
        return Promise.resolve(() => undefined);
      }),
    },
    shellYieldChanged: {
      listen: vi.fn((cb: Listener<YieldPayload>) => {
        listeners.yield.push(cb);
        return Promise.resolve(() => undefined);
      }),
    },
  },
}));

const layout = (overrides: Partial<ShellLayout> = {}): ShellLayout => ({
  label: 'notch',
  monitorId: '\\\\.\\DISPLAY1',
  isPrimary: true,
  enabled: true,
  mode: 'overlay',
  shape: 'notch',
  stripHeight: 32,
  stripTopOffset: 0,
  panelMaxWidth: 1000,
  scalePercent: 100,
  yieldState: 'none',
  ...overrides,
});

const renderNotch = () =>
  render(
    <AppProviders>
      <NotchWindow />
    </AppProviders>,
  );

describe('NotchWindow', () => {
  beforeEach(() => {
    listeners.layout.length = 0;
    listeners.yield.length = 0;
    useAppStore.setState({ shellLayout: null, yieldState: 'none' });
    vi.clearAllMocks();
  });

  it('renders the idle strip with an accessible placeholder', () => {
    renderNotch();
    const strip = screen.getByRole('status');
    expect(strip).toHaveAttribute('data-kind', 'idle');
    expect(screen.getByText('Muna is running.')).toBeInTheDocument();
  });

  it('publishes the strip rect and reports ready after the first painted frame', async () => {
    renderNotch();
    await waitFor(() => {
      expect(commands.shellReady).toHaveBeenCalledTimes(1);
    });
    expect(commands.publishShapeRects).toHaveBeenCalledTimes(1);
    expect(commands.publishShapeRects.mock.calls[0]?.[0]).toHaveLength(1);
    expect(commands.getShellLayout).toHaveBeenCalledTimes(1);
  });

  it('follows its own layout and yield events and ignores other windows', async () => {
    renderNotch();
    await waitFor(() => {
      expect(listeners.layout).toHaveLength(1);
      expect(listeners.yield).toHaveLength(1);
    });
    const main = screen.getByRole('main');
    const strip = screen.getByRole('status');

    act(() => {
      listeners.layout[0]?.({
        payload: { layout: layout({ label: 'notch-1', shape: 'island', stripHeight: 38 }) },
      });
    });
    expect(main).toHaveAttribute('data-shape', 'notch');

    act(() => {
      listeners.layout[0]?.({
        payload: { layout: layout({ shape: 'island', stripHeight: 38, stripTopOffset: 8 }) },
      });
    });
    expect(main).toHaveAttribute('data-shape', 'island');
    expect(strip).toHaveStyle({ height: '38px', marginTop: '8px' });

    act(() => {
      listeners.yield[0]?.({ payload: { label: 'notch-1', state: 'parked' } });
    });
    expect(main).toHaveAttribute('data-yield', 'none');

    act(() => {
      listeners.yield[0]?.({ payload: { label: 'notch', state: 'peek' } });
    });
    expect(main).toHaveAttribute('data-yield', 'peek');
    expect(strip).toBeVisible();

    act(() => {
      listeners.yield[0]?.({ payload: { label: 'notch', state: 'parked' } });
    });
    expect(main).toHaveAttribute('data-yield', 'parked');
    expect(strip).not.toBeVisible();
  });
});
