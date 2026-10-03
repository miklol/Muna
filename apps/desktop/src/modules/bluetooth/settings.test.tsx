import type { BluetoothSnapshot, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readBluetoothSettings, writeBluetoothSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useBluetoothStore } from './bluetooth-store';
import { BluetoothSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getBluetoothSnapshot: vi.fn<() => Promise<BluetoothSnapshot>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten: the pane never receives an event in these tests.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getBluetoothSnapshot: ipc.getBluetoothSnapshot,
  },
  events: {
    bluetoothChanged: { listen: ipc.listen },
  },
}));

const paired: BluetoothSnapshot = {
  radio: 'on',
  available: true,
  devices: [
    {
      id: 'buds',
      name: 'Buds',
      connected: true,
      batteryPercent: 80,
      kind: 'headphones',
      hidden: false,
    },
    {
      id: 'mouse',
      name: 'Mouse',
      connected: false,
      batteryPercent: null,
      kind: 'mouse',
      hidden: true,
    },
  ],
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('BluetoothSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useBluetoothStore.setState({ snapshot: null, pending: {}, errors: {} });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getBluetoothSnapshot.mockReset().mockResolvedValue(paired);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPane = () => {
    const Host = () => {
      const settings = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <BluetoothSettingsPane />
        </SettingsEditorProvider>
      );
    };
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <Host />
        </QueryClientProvider>
      </I18nextProvider>,
    );
  };

  const saved = () =>
    readBluetoothSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults and one row per paired device, each named by kind', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Low battery notices' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Buds' })).toBeChecked();
    expect(screen.getByText('Headphones')).toBeInTheDocument();
    // The document, not the snapshot flag, decides what the pane shows: defaults hide nothing.
    expect(screen.getByRole('switch', { name: 'Mouse' })).toBeChecked();
  });

  it('reads hidden devices from the namespace and saves a hide and a show', async () => {
    cacheSettings(
      queryClient,
      writeBluetoothSettings(defaultSettings(), {
        lowBatteryNotices: false,
        hiddenDevices: ['mouse'],
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Low battery notices' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mouse' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('switch', { name: 'Buds' }));
    await flush();
    expect(saved().hiddenDevices).toEqual(['mouse', 'buds']);
    expect(saved().lowBatteryNotices).toBe(false);

    fireEvent.click(screen.getByRole('switch', { name: 'Mouse' }));
    await flush();
    expect(saved().hiddenDevices).toEqual(['buds']);
  });

  it('saves the notices toggle at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Low battery notices' }));
    await flush();
    expect(saved().lowBatteryNotices).toBe(false);
    expect(saved().hiddenDevices).toEqual([]);
  });

  it('says when nothing is paired', async () => {
    ipc.getBluetoothSnapshot.mockResolvedValue({ radio: 'on', available: true, devices: [] });
    renderPane();
    await flush();
    expect(screen.getByText('No paired devices to show.')).toBeInTheDocument();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });
});
