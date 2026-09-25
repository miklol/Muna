import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readSystemMonitorSettings,
  writeSystemMonitorSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { SystemMonitorSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
  },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('SystemMonitorSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
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

  const renderPane = () => {
    const Host = () => {
      const settings = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <SystemMonitorSettingsPane />
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
    readSystemMonitorSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults: strip gauge off, five processes', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Show CPU in the strip' })).not.toBeChecked();
    expect(screen.getByRole('slider', { name: 'Processes shown' })).toHaveValue('5');
    expect(screen.getByText('5 processes')).toBeInTheDocument();
  });

  it('reads the namespace and words a single process and none', async () => {
    cacheSettings(
      queryClient,
      writeSystemMonitorSettings(defaultSettings(), { showCpuInStrip: true, processCount: 1 }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Show CPU in the strip' })).toBeChecked();
    expect(screen.getByText('1 process')).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: 'Processes shown' });
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    await flush();
    expect(screen.getByText('None')).toBeInTheDocument();
    expect(saved().processCount).toBe(0);
  });

  it('saves the strip toggle at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show CPU in the strip' }));
    await flush();
    expect(saved().showCpuInStrip).toBe(true);
    expect(saved().processCount).toBe(5);
  });

  it('saves the process slider on release and stops at the bounds', async () => {
    renderPane();
    await flush();
    const slider = screen.getByRole('slider', { name: 'Processes shown' });
    fireEvent.keyDown(slider, { key: 'End' });
    await flush();
    expect(saved().processCount).toBe(10);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    await flush();
    expect(saved().processCount).toBe(10);
  });
});
