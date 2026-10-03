import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  DEFAULT_DASHBOARD_SLOTS,
  defaultSettings,
  readDashboardSettings,
  writeDashboardSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { DashboardSettingsPane } from './settings';

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

describe('DashboardSettingsPane', () => {
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
          <DashboardSettingsPane />
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

  it('reports the default layout: seven widgets on all eight cells', async () => {
    renderPane();
    await flush();
    expect(screen.getByText('7 widgets')).toBeInTheDocument();
    expect(screen.getByText('8 of 8 cells used')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument();
  });

  it('reports an edited layout and puts the defaults back on reset', async () => {
    renderPane(
      writeDashboardSettings(defaultSettings(), {
        slots: [
          { moduleId: 'weather', span: 2 },
          { moduleId: 'todo', span: 1 },
        ],
      }),
    );
    await flush();
    expect(screen.getByText('2 widgets')).toBeInTheDocument();
    expect(screen.getByText('3 of 8 cells used')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await flush();
    expect(ipc.updateSettings).toHaveBeenCalledTimes(1);
    const saved = ipc.updateSettings.mock.lastCall?.[0];
    expect(saved === undefined ? undefined : readDashboardSettings(saved).slots).toEqual(
      DEFAULT_DASHBOARD_SLOTS,
    );
    expect(screen.getByText('7 widgets')).toBeInTheDocument();
  });
});
