import type { BluetoothSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useBluetoothStore } from './bluetooth-store';
import { BluetoothWidget, WIDGET_ROWS } from './widget';

const ipc = vi.hoisted(() => ({
  getBluetoothSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getBluetoothSnapshot: ipc.getBluetoothSnapshot },
  events: { bluetoothChanged: { listen: ipc.listen } },
}));

type Device = BluetoothSnapshot['devices'][number];

const device = (overrides: Partial<Device> & Pick<Device, 'id' | 'name'>): Device => ({
  connected: true,
  batteryPercent: null,
  kind: 'other',
  hidden: false,
  ...overrides,
});

const snapshot = (overrides: Partial<BluetoothSnapshot> = {}): BluetoothSnapshot => ({
  radio: 'on',
  available: true,
  devices: [
    device({ id: 'buds', name: 'Buds', batteryPercent: 80, kind: 'headphones' }),
    device({ id: 'mouse', name: 'Mouse', connected: false, kind: 'mouse' }),
    device({ id: 'watch', name: 'Watch', hidden: true }),
  ],
  ...overrides,
});

const renderWidget = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <BluetoothWidget span={1} />
    </I18nextProvider>,
  );

describe('BluetoothWidget', () => {
  beforeEach(() => {
    useBluetoothStore.setState({ snapshot: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('lists connected devices the user has not hidden, with their battery', () => {
    useBluetoothStore.getState().setSnapshot(snapshot());
    renderWidget();
    const rows = within(screen.getByRole('list', { name: 'Devices' })).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Buds');
    expect(rows[0]).toHaveTextContent('80%');
    expect(screen.queryByText('Mouse')).not.toBeInTheDocument();
    expect(screen.queryByText('Watch')).not.toBeInTheDocument();
  });

  it('caps the rows and counts the rest', () => {
    useBluetoothStore.getState().setSnapshot(
      snapshot({
        devices: Array.from({ length: WIDGET_ROWS + 2 }, (_, index) =>
          device({ id: `d${String(index)}`, name: `Device ${String(index)}` }),
        ),
      }),
    );
    renderWidget();
    expect(screen.getAllByRole('listitem')).toHaveLength(WIDGET_ROWS);
    expect(screen.getByText('2 more')).toBeInTheDocument();
  });

  it('says in one line when nothing is connected, the radio is off or Bluetooth is missing', () => {
    const cases: [Partial<BluetoothSnapshot>, string][] = [
      [{ devices: [] }, 'No devices connected'],
      [{ radio: 'off' }, 'Bluetooth is off'],
      [{ radio: 'unavailable' }, 'No Bluetooth radio'],
      [{ available: false }, 'Bluetooth is not available'],
    ];
    for (const [overrides, text] of cases) {
      useBluetoothStore.getState().setSnapshot(snapshot(overrides));
      const view = renderWidget();
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
      view.unmount();
    }
  });
});
