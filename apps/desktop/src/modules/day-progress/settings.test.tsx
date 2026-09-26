import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultDayProgressSettings,
  defaultSettings,
  readDayProgressSettings,
  writeDayProgressSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { DayProgressSettingsPane, DEFAULT_BEDTIME_MINUTES, formatMinutes } from './settings';

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

describe('formatMinutes', () => {
  it('writes a time of day the way the locale does', () => {
    expect(formatMinutes(0, 'en')).toBe('12:00 AM');
    expect(formatMinutes(9 * 60, 'en')).toBe('9:00 AM');
    expect(formatMinutes(23 * 60 + 59, 'en')).toBe('11:59 PM');
  });
});

describe('DayProgressSettingsPane', () => {
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
          <DayProgressSettingsPane />
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
    readDayProgressSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults: 09:00 to 18:00, no bedtime, strip bar off, both sources on', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('slider', { name: 'Start' })).toHaveValue('540');
    expect(screen.getByText('9:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'End' })).toHaveValue('1080');
    expect(screen.getByText('6:00 PM')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show a bedtime marker' })).not.toBeChecked();
    expect(screen.queryByRole('slider', { name: 'Bedtime' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show the day bar in the strip' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Tasks due today' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Focus sessions' })).toBeChecked();
  });

  it('turns the bedtime marker on at 23:00 and lets it move in quarter hours', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show a bedtime marker' }));
    await flush();
    expect(saved().bedtimeMinutes).toBe(DEFAULT_BEDTIME_MINUTES);
    const slider = screen.getByRole('slider', { name: 'Bedtime' });
    expect(slider).toHaveValue('1380');
    expect(screen.getByText('11:00 PM')).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    await flush();
    expect(saved().bedtimeMinutes).toBe(1365);
    expect(screen.getByText('10:45 PM')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Show a bedtime marker' }));
    await flush();
    expect(saved().bedtimeMinutes).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Bedtime' })).toBeNull();
  });

  it('keeps the end after the start: moving the start to its limit drags the end along', async () => {
    renderPane();
    await flush();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Start' }), { key: 'End' });
    await flush();
    // The start stops a quarter hour short of the last minute (steps of 15 from midnight), and
    // the end follows to leave the shortest working day.
    expect(saved().workStartMinutes).toBe(1410);
    expect(saved().workEndMinutes).toBe(1425);
    expect(screen.getByRole('slider', { name: 'End' })).toHaveValue('1425');
    expect(screen.getByText('11:30 PM')).toBeInTheDocument();
    expect(screen.getByText('11:45 PM')).toBeInTheDocument();
  });

  it('will not let the end fall before the shortest working day', async () => {
    cacheSettings(
      queryClient,
      writeDayProgressSettings(defaultSettings(), {
        ...defaultDayProgressSettings(),
        workStartMinutes: 600,
        workEndMinutes: 630,
      }),
    );
    renderPane();
    await flush();
    const end = screen.getByRole('slider', { name: 'End' });
    expect(end).toHaveValue('630');
    fireEvent.keyDown(end, { key: 'Home' });
    await flush();
    expect(saved().workStartMinutes).toBe(600);
    expect(saved().workEndMinutes).toBe(615);
  });

  it('saves the strip and source toggles at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show the day bar in the strip' }));
    await flush();
    expect(saved().showDayInStrip).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Tasks due today' }));
    await flush();
    expect(saved().showTasks).toBe(false);
    expect(saved().showDayInStrip).toBe(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Focus sessions' }));
    await flush();
    expect(saved().showFocusSessions).toBe(false);
    expect(saved().workStartMinutes).toBe(540);
  });
});
