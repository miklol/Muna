import type { SystemMonitorSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { buildGauges, SystemMonitorPanel } from './panel';
import { NETWORK_RING_FLOOR_BYTES_PER_S, useSystemMonitorStore } from './system-monitor-store';

type Listener<T> = (event: { payload: T }) => void;

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: SystemMonitorSnapshot }>[] = [];
  return {
    systemMonitorWatch: vi.fn<(watching: boolean) => Promise<SystemMonitorSnapshot | null>>(),
    listen: vi.fn((callback: Listener<{ snapshot: SystemMonitorSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: SystemMonitorSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    systemMonitorWatch: ipc.systemMonitorWatch,
  },
  events: {
    systemMonitorChanged: { listen: ipc.listen },
  },
}));

const KIB = 1024;
const MIB = KIB * 1024;
const GIB = MIB * 1024;

const snapshot = (overrides: Partial<SystemMonitorSnapshot> = {}): SystemMonitorSnapshot => ({
  cpuPercent: 37,
  logicalCpus: 8,
  memoryUsedBytes: 15.9 * GIB,
  memoryTotalBytes: 32 * GIB,
  storageUsedBytes: 700 * GIB,
  storageTotalBytes: 1000 * GIB,
  freeDiskBytes: 120 * GIB,
  systemDiskTotalBytes: 500 * GIB,
  networkDownBytesPerS: 300 * KIB,
  networkUpBytesPerS: 12 * KIB,
  battery: { percent: 64, charging: true },
  processes: [
    { name: 'chrome', cpuTenths: 123, memoryBytes: 2.5 * GIB, count: 14 },
    { name: 'muna', cpuTenths: 4, memoryBytes: 90 * MIB, count: 1 },
  ],
  sampledAtMs: 1_700_000_000_000,
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <SystemMonitorPanel />
    </I18nextProvider>,
  );

/** Lets the watch reply settle and the rings run their frame. */
const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });

const tile = (id: string) => {
  const element = document.querySelector(`[data-gauge="${id}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`no ${id} tile`);
  return element;
};
const valueOf = (id: string) => tile(id).querySelector('.sysmon-tile__value')?.textContent;
const detailOf = (id: string) => tile(id).querySelector('.sysmon-tile__detail')?.textContent;

describe('buildGauges', () => {
  const formatters = { t: i18n.t.bind(i18n), locale: 'en' };

  it('waits on every tile before the first reading', () => {
    const gauges = buildGauges(null, 0, formatters);
    expect(gauges.map((gauge) => gauge.id)).toEqual([
      'cpu',
      'memory',
      'storage',
      'network',
      'battery',
      'freeDisk',
    ]);
    for (const gauge of gauges) {
      expect(gauge.fraction).toBeNull();
      expect(gauge.value).toBe('—');
      expect(gauge.detail).toBe('Reading…');
    }
  });

  it('draws the network ring against the peak seen, never below the floor', () => {
    const quiet = snapshot({ networkDownBytesPerS: 16 * KIB, networkUpBytesPerS: 0 });
    const [, , , againstFloor] = buildGauges(quiet, 0, formatters);
    expect(againstFloor?.fraction).toBeCloseTo(((16 * KIB) / NETWORK_RING_FLOOR_BYTES_PER_S) * 100);
    const [, , , againstPeak] = buildGauges(quiet, 256 * KIB, formatters);
    expect(againstPeak?.fraction).toBe(6.25);
  });

  it('colours the battery by charge and names the state', () => {
    const at = (percent: number, charging = false) =>
      buildGauges(snapshot({ battery: { percent, charging } }), 0, formatters)[4];
    expect(at(64, true)).toMatchObject({ tint: 'green', value: '64%', detail: 'Charging' });
    expect(at(20)).toMatchObject({ tint: 'orange', detail: 'Not charging' });
    expect(at(10)).toMatchObject({ tint: 'red' });
    const [, , , , none] = buildGauges(snapshot({ battery: null }), 0, formatters);
    expect(none).toMatchObject({ fraction: null, value: '—', detail: 'No battery' });
  });

  it('leaves cpu and network pending while Rust has only one sample', () => {
    const first = snapshot({
      cpuPercent: null,
      networkDownBytesPerS: null,
      networkUpBytesPerS: null,
    });
    const [cpu, , , network] = buildGauges(first, 0, formatters);
    expect(cpu).toMatchObject({ fraction: null, value: '—', detail: '8 cores' });
    expect(network).toMatchObject({ fraction: null, value: '—', detail: '—' });
  });
});

describe('SystemMonitorPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSystemMonitorStore.setState({ snapshot: null, receivedAt: 0, peakNetworkBytesPerS: 0 });
    ipc.systemMonitorWatch.mockReset().mockResolvedValue(null);
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

  it('starts watching on mount, paints the reply, and stops on unmount', async () => {
    ipc.systemMonitorWatch.mockResolvedValue(snapshot());
    const view = renderPanel();
    await flush();
    expect(ipc.systemMonitorWatch).toHaveBeenCalledTimes(1);
    expect(ipc.systemMonitorWatch).toHaveBeenLastCalledWith(true);
    expect(ipc.listenerCount()).toBe(1);

    expect(screen.getByRole('list', { name: 'System' })).toBeInTheDocument();
    expect(valueOf('cpu')).toBe('37%');
    expect(detailOf('cpu')).toBe('8 cores');
    expect(valueOf('memory')).toBe('15.9 GB');
    expect(detailOf('memory')).toBe('of 32.0 GB');
    expect(valueOf('storage')).toBe('700.0 GB');
    expect(detailOf('storage')).toBe('of 1,000.0 GB');
    expect(valueOf('network')).toBe('312 kB/s');
    expect(detailOf('network')).toBe('↓ 300 kB/s ↑ 12 kB/s');
    expect(valueOf('battery')).toBe('64%');
    expect(detailOf('battery')).toBe('Charging');
    expect(valueOf('freeDisk')).toBe('120.0 GB');
    expect(detailOf('freeDisk')).toBe('of 500.0 GB');

    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(6);
    expect(meters[0]).toHaveAttribute('aria-label', 'CPU');
    expect(meters[0]).toHaveAttribute('aria-valuetext', 'CPU: 37%, 8 cores');
    expect(meters[0]).toHaveAttribute('aria-valuenow', '37');

    view.unmount();
    await flush();
    expect(ipc.systemMonitorWatch).toHaveBeenCalledTimes(2);
    expect(ipc.systemMonitorWatch).toHaveBeenLastCalledWith(false);
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows dashes and "Reading…" until the first reading, then follows events', async () => {
    renderPanel();
    await flush();
    expect(valueOf('cpu')).toBe('—');
    expect(detailOf('cpu')).toBe('Reading…');
    expect(screen.queryByRole('table')).toBeNull();
    const meters = screen.getAllByRole('meter');
    expect(meters[1]).toHaveAttribute('aria-valuetext', 'Memory: Reading…');
    expect(meters[1]).toHaveAttribute('aria-valuenow', '0');

    act(() => {
      ipc.emit(snapshot({ cpuPercent: 52 }));
    });
    await flush();
    expect(valueOf('cpu')).toBe('52%');
    expect(useSystemMonitorStore.getState().peakNetworkBytesPerS).toBe(312 * KIB);
  });

  it('lists the busiest processes with an instance count, most CPU first', async () => {
    ipc.systemMonitorWatch.mockResolvedValue(snapshot());
    renderPanel();
    await flush();
    const table = screen.getByRole('table', { name: 'Top processes' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Name', 'CPU', 'Memory']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    const chrome = rows[0];
    if (chrome === undefined) throw new Error('missing row');
    expect(within(chrome).getByText('chrome')).toBeInTheDocument();
    expect(within(chrome).getByLabelText('14 processes')).toHaveTextContent('×14');
    expect(within(chrome).getByText('12.3%')).toBeInTheDocument();
    expect(within(chrome).getByText('2.5 GB')).toBeInTheDocument();
    const muna = rows[1];
    if (muna === undefined) throw new Error('missing row');
    expect(within(muna).queryByText(/×/)).toBeNull();
    expect(within(muna).getByText('0.4%')).toBeInTheDocument();
    expect(within(muna).getByText('90 MB')).toBeInTheDocument();
  });

  it('hides the table when the reading carries no processes', async () => {
    ipc.systemMonitorWatch.mockResolvedValue(snapshot({ processes: [] }));
    renderPanel();
    await flush();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getAllByRole('meter')).toHaveLength(6);
  });

  it('keeps a seeded reading when the commands are unavailable', async () => {
    useSystemMonitorStore.getState().setSnapshot(snapshot({ cpuPercent: 9 }), 1);
    ipc.systemMonitorWatch.mockRejectedValue(new Error('outside tauri'));
    ipc.listen.mockRejectedValueOnce(new Error('outside tauri'));
    renderPanel();
    await flush();
    expect(valueOf('cpu')).toBe('9%');
  });
});
