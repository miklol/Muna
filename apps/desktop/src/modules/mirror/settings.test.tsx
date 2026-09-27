import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  type IpcError,
  readMirrorSettings,
  type Settings,
  writeMirrorSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { MirrorSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { updateSettings: ipc.updateSettings, getSettings: ipc.getSettings },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('MirrorSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPane = (settings: Settings = defaultSettings()) => {
    cacheSettings(queryClient, settings);
    const Host = () => {
      const current = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={current}>
          <MirrorSettingsPane />
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
    readMirrorSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults: camera off, mirrored, the system default camera', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Use the camera' })).not.toBeChecked();
    expect(
      screen.getByText(/Off by default\. Muna opens the camera only while/),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Mirror the image' })).toBeChecked();
    expect(
      screen.getByText('The system default. Switch cameras from the panel.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use default' })).toBeDisabled();
  });

  it('writes the switches into the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Use the camera' }));
    await flush();
    expect(saved().enabled).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Mirror the image' }));
    await flush();
    expect(saved().flip).toBe(false);
  });

  it('names the chosen camera and clears it back to the default', async () => {
    renderPane(
      writeMirrorSettings(defaultSettings(), {
        enabled: true,
        flip: true,
        deviceId: 'cam-2',
        deviceLabel: 'Desk camera',
      }),
    );
    await flush();
    expect(screen.getByText('Desk camera. Switch cameras from the panel.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    await flush();
    expect(saved()).toMatchObject({ deviceId: null, deviceLabel: null, enabled: true });
    expect(screen.getByRole('button', { name: 'Use default' })).toBeDisabled();
  });
});
