import type { BluetoothCommand, BluetoothSnapshot, IpcError } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useBluetoothStore } from './bluetooth-store';
import { BluetoothPanel, deviceStatus, errorKey } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: BluetoothSnapshot }>[] = [];
  return {
    getBluetoothSnapshot: vi.fn<() => Promise<BluetoothSnapshot>>(),
    bluetoothCommand: vi.fn<(command: BluetoothCommand) => Promise<IpcResult<BluetoothSnapshot>>>(),
    listen: vi.fn((callback: Listener<{ snapshot: BluetoothSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: BluetoothSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getBluetoothSnapshot: ipc.getBluetoothSnapshot,
    bluetoothCommand: ipc.bluetoothCommand,
  },
  events: {
    bluetoothChanged: { listen: ipc.listen },
  },
}));

const buds = {
  id: 'buds',
  name: 'Buds',
  connected: true,
  batteryPercent: 80,
  kind: 'headphones',
  hidden: false,
} as const satisfies BluetoothSnapshot['devices'][number];
const mouse = {
  id: 'mouse',
  name: 'Mouse',
  connected: false,
  batteryPercent: null,
  kind: 'mouse',
  hidden: false,
} as const satisfies BluetoothSnapshot['devices'][number];

const snapshot = (overrides: Partial<BluetoothSnapshot> = {}): BluetoothSnapshot => ({
  radio: 'on',
  available: true,
  devices: [buds, mouse],
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <BluetoothPanel />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const row = (name: string) => {
  const label = screen.getByText(name);
  const item = label.closest('li');
  if (item === null) throw new Error(`no row for ${name}`);
  return item;
};

describe('deviceStatus and errorKey', () => {
  const t = i18n.t.bind(i18n);

  it('words the connection, the battery and a command in flight', () => {
    expect(deviceStatus(buds, undefined, t, 'en')).toBe('Connected · 80%');
    expect(deviceStatus({ ...buds, batteryPercent: null }, undefined, t, 'en')).toBe('Connected');
    expect(deviceStatus(mouse, undefined, t, 'en')).toBe('Not connected');
    expect(deviceStatus(mouse, 'connect', t, 'en')).toBe('Connecting…');
    expect(deviceStatus(buds, 'disconnect', t, 'en')).toBe('Disconnecting…');
  });

  it('maps the platform error codes and falls back to a retry line', () => {
    expect(errorKey({ code: 'platform.unsupported', message: '' })).toBe(
      'bluetooth.error.unsupported',
    );
    expect(errorKey({ code: 'platform.notFound', message: '' })).toBe('bluetooth.error.notFound');
    expect(errorKey({ code: 'platform.accessDenied', message: '' })).toBe(
      'bluetooth.error.accessDenied',
    );
    expect(errorKey({ code: 'platform.os', message: '' })).toBe('bluetooth.error.os');
  });
});

describe('BluetoothPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBluetoothStore.setState({
      snapshot: null,
      pending: {},
      radioPending: false,
      errors: {},
      radioError: null,
    });
    ipc.getBluetoothSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.bluetoothCommand.mockReset();
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

  it('subscribes on mount, lists devices connected first, and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getBluetoothSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    expect(screen.getByRole('switch', { name: 'Bluetooth' })).toBeChecked();
    expect(screen.getByText('On')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Devices' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('.muna-list-row__label')?.textContent)).toEqual([
      'Buds',
      'Mouse',
    ]);
    expect(within(row('Buds')).getByText('Connected · 80%')).toBeInTheDocument();
    expect(within(row('Buds')).getByRole('button', { name: 'Disconnect Buds' })).toBeEnabled();
    expect(within(row('Mouse')).getByText('Not connected')).toBeInTheDocument();
    expect(within(row('Mouse')).getByRole('button', { name: 'Connect' })).toBeEnabled();

    view.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('connects a device, shows it pending until Windows answers, then follows the reply', async () => {
    let answer: ((result: IpcResult<BluetoothSnapshot>) => void) | null = null;
    ipc.bluetoothCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderPanel();
    await flush();
    fireEvent.click(within(row('Mouse')).getByRole('button', { name: 'Connect' }));
    await flush();
    expect(ipc.bluetoothCommand).toHaveBeenCalledWith({ kind: 'connect', id: 'mouse' });
    expect(within(row('Mouse')).getByText('Connecting…')).toBeInTheDocument();
    expect(within(row('Mouse')).getByRole('button', { name: 'Connect' })).toBeDisabled();

    const connected = snapshot({ devices: [buds, { ...mouse, connected: true }] });
    act(() => {
      answer?.({ status: 'ok', data: connected });
    });
    await flush();
    expect(within(row('Mouse')).getByText('Connected')).toBeInTheDocument();
    expect(within(row('Mouse')).getByRole('button', { name: 'Disconnect Mouse' })).toBeEnabled();
    expect(useBluetoothStore.getState().pending).toEqual({});
  });

  it('says in place when a device will not connect', async () => {
    ipc.bluetoothCommand.mockResolvedValue({
      status: 'error',
      error: { code: 'platform.unsupported', message: 'bluetooth connect is not supported' },
    });
    renderPanel();
    await flush();
    fireEvent.click(within(row('Mouse')).getByRole('button', { name: 'Connect' }));
    await flush();
    const alert = within(row('Mouse')).getByRole('alert');
    expect(alert).toHaveTextContent('Not supported for this device');
    expect(within(row('Mouse')).getByRole('button', { name: 'Connect' })).toBeEnabled();
    // The next report about the device clears the refusal.
    act(() => {
      ipc.emit(snapshot({ devices: [buds, { ...mouse, connected: true }] }));
    });
    await flush();
    expect(within(row('Mouse')).queryByRole('alert')).toBeNull();
    expect(within(row('Mouse')).getByText('Connected')).toBeInTheDocument();
  });

  it('disconnects a connected device', async () => {
    ipc.bluetoothCommand.mockResolvedValue({
      status: 'ok',
      data: snapshot({ devices: [{ ...buds, connected: false, batteryPercent: null }, mouse] }),
    });
    renderPanel();
    await flush();
    fireEvent.click(within(row('Buds')).getByRole('button', { name: 'Disconnect Buds' }));
    await flush();
    expect(ipc.bluetoothCommand).toHaveBeenCalledWith({ kind: 'disconnect', id: 'buds' });
    expect(within(row('Buds')).getByText('Not connected')).toBeInTheDocument();
    expect(within(row('Buds')).getByRole('button', { name: 'Connect' })).toBeInTheDocument();
  });

  it('switches the radio and reports a refusal beside it', async () => {
    ipc.bluetoothCommand.mockResolvedValue({
      status: 'error',
      error: { code: 'platform.accessDenied', message: 'access denied: bluetooth radio' },
    });
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Bluetooth' }));
    await flush();
    expect(ipc.bluetoothCommand).toHaveBeenCalledWith({ kind: 'setRadio', on: false });
    expect(screen.getByRole('alert')).toHaveTextContent('Windows would not allow it');
    expect(screen.getByRole('switch', { name: 'Bluetooth' })).toBeChecked();

    ipc.bluetoothCommand.mockResolvedValue({ status: 'ok', data: snapshot({ radio: 'off' }) });
    fireEvent.click(screen.getByRole('switch', { name: 'Bluetooth' }));
    await flush();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('switch', { name: 'Bluetooth' })).not.toBeChecked();
    expect(screen.getByText('Bluetooth is off')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('leaves hidden devices out and says when there is nothing to show', async () => {
    ipc.getBluetoothSnapshot.mockResolvedValue(
      snapshot({
        devices: [
          { ...buds, hidden: true },
          { ...mouse, hidden: true },
        ],
      }),
    );
    renderPanel();
    await flush();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText('No paired devices')).toBeInTheDocument();
    expect(
      screen.getByText('Pair a device in Windows Settings and it will appear here.'),
    ).toBeInTheDocument();
  });

  it('explains a PC without Bluetooth and disables the switch when the radio is unknown', async () => {
    ipc.getBluetoothSnapshot.mockResolvedValue(
      snapshot({ radio: 'unavailable', available: false, devices: [] }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Bluetooth is not available')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).toBeNull();

    act(() => {
      ipc.emit(snapshot({ radio: 'unavailable', devices: [mouse] }));
    });
    await flush();
    expect(screen.getByRole('switch', { name: 'Bluetooth' })).toBeDisabled();
    expect(screen.getByText('No Bluetooth radio')).toBeInTheDocument();
    expect(within(row('Mouse')).getByText('Not connected')).toBeInTheDocument();
  });
});
