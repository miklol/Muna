import type { SystemMonitorSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useSystemMonitorStore } from './system-monitor-store';
import { SystemMonitorWidget, WIDGET_GAUGES } from './widget';

const ipc = vi.hoisted(() => ({
  systemMonitorWatch: vi.fn<(watching: boolean) => Promise<SystemMonitorSnapshot | null>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { systemMonitorWatch: ipc.systemMonitorWatch },
  events: { systemMonitorChanged: { listen: ipc.listen } },
}));

const KIB = 1024;
const GIB = KIB * KIB * KIB;

const snapshot: SystemMonitorSnapshot = {
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
  battery: null,
  processes: [],
  sampledAtMs: 1_700_000_000_000,
};

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <SystemMonitorWidget span={span} />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await Promise.resolve();
  });

describe('SystemMonitorWidget', () => {
  beforeEach(() => {
    useSystemMonitorStore.setState({ snapshot: null, receivedAt: 0, peakNetworkBytesPerS: 0 });
    ipc.systemMonitorWatch.mockReset().mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows CPU and memory on a narrow card and adds storage and network on a wide one', () => {
    useSystemMonitorStore.getState().setSnapshot(snapshot);
    const narrow = renderWidget(1);
    const list = () => within(screen.getByRole('list', { name: 'System' }));
    expect(list().getAllByRole('listitem')).toHaveLength(WIDGET_GAUGES[1]);
    expect(list().getByRole('meter', { name: 'CPU' })).toHaveAttribute('aria-valuenow', '37');
    expect(screen.getByText('37%')).toBeInTheDocument();
    expect(screen.getByText('15.9 GB')).toBeInTheDocument();
    expect(screen.queryByText('Storage')).not.toBeInTheDocument();
    narrow.unmount();

    renderWidget(2);
    expect(list().getAllByRole('listitem')).toHaveLength(WIDGET_GAUGES[2]);
    expect(screen.getByText('Storage')).toBeInTheDocument();
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('312 kB/s')).toBeInTheDocument();
  });

  it('shows dashes before the first sample', () => {
    renderWidget(1);
    expect(screen.getAllByText('—')).toHaveLength(WIDGET_GAUGES[1]);
  });

  it('starts sampling when mounted and stops when unmounted', async () => {
    const view = renderWidget(1);
    await flush();
    expect(ipc.systemMonitorWatch).toHaveBeenCalledTimes(1);
    expect(ipc.systemMonitorWatch).toHaveBeenLastCalledWith(true);
    view.unmount();
    await flush();
    expect(ipc.systemMonitorWatch).toHaveBeenCalledTimes(2);
    expect(ipc.systemMonitorWatch).toHaveBeenLastCalledWith(false);
  });
});
