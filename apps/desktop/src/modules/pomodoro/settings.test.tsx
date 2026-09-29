import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readPomodoroSettings, writePomodoroSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { PomodoroSettingsPane } from './settings';

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

describe('PomodoroSettingsPane', () => {
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
          <PomodoroSettingsPane />
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
    readPomodoroSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the lengths, the cycle and auto-start from the document', async () => {
    cacheSettings(
      queryClient,
      writePomodoroSettings(defaultSettings(), {
        workMinutes: 50,
        shortBreakMinutes: 10,
        longBreakMinutes: 30,
        longBreakEvery: 3,
        autoStartNext: true,
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('slider', { name: 'Focus' })).toHaveValue('50');
    expect(screen.getByText('50 min')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Short break' })).toHaveValue('10');
    expect(screen.getByRole('slider', { name: 'Long break' })).toHaveValue('30');
    expect(screen.getByRole('slider', { name: 'Long break after' })).toHaveValue('3');
    expect(screen.getByText('3 phases')).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: 'Start the next phase automatically' }),
    ).toBeChecked();
  });

  it('writes the namespace without touching other settings and respects the bounds', async () => {
    renderPane();
    await flush();
    const work = screen.getByRole('slider', { name: 'Focus' });
    expect(work).toHaveValue('25');
    expect(work).toHaveAttribute('min', '5');
    expect(work).toHaveAttribute('max', '90');
    fireEvent.keyDown(work, { key: 'ArrowRight' });
    fireEvent.keyUp(work, { key: 'ArrowRight' });
    await flush();
    expect(saved()).toEqual({
      workMinutes: 26,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 4,
      autoStartNext: false,
    });

    const every = screen.getByRole('slider', { name: 'Long break after' });
    expect(every).toHaveAttribute('min', '2');
    expect(every).toHaveAttribute('max', '8');
    fireEvent.keyDown(every, { key: 'ArrowLeft' });
    fireEvent.keyUp(every, { key: 'ArrowLeft' });
    await flush();
    expect(saved().longBreakEvery).toBe(3);

    fireEvent.click(screen.getByRole('switch', { name: 'Start the next phase automatically' }));
    await flush();
    expect(saved()).toEqual({
      workMinutes: 26,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEvery: 3,
      autoStartNext: true,
    });
    expect(ipc.updateSettings.mock.lastCall?.[0].general).toEqual(defaultSettings().general);
    expect(ipc.updateSettings.mock.lastCall?.[0].shell).toEqual(defaultSettings().shell);
  });
});
