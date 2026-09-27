import type { HealthCommand, HealthSnapshot, IpcError, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readHealthSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useHealthStore } from './health-store';
import { sampleSnapshot } from './sample-snapshot';
import { breaksGoalFor, HealthSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  healthCommand: vi.fn<(command: HealthCommand) => Promise<IpcResult<HealthSnapshot>>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    healthCommand: ipc.healthCommand,
  },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const nudge = (slider: HTMLElement, key: 'ArrowRight' | 'ArrowLeft') => {
  fireEvent.keyDown(slider, { key });
  fireEvent.keyUp(slider, { key });
};

describe('breaksGoalFor', () => {
  it('derives the daily breaks goal from the interval like Rust does', () => {
    expect(breaksGoalFor(50)).toBe(7);
    expect(breaksGoalFor(15)).toBe(24);
    expect(breaksGoalFor(180)).toBe(2);
    expect(breaksGoalFor(400)).toBe(1);
  });
});

describe('HealthSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useHealthStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.healthCommand.mockReset().mockImplementation((command) =>
      Promise.resolve({
        status: 'ok',
        data:
          command.kind === 'reset' || command.kind === 'clearHistory'
            ? sampleSnapshot({
                today: { ...sampleSnapshot().today, breaks: 0, water: 0, mindfulSeconds: 0 },
              })
            : sampleSnapshot(),
      }),
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
          <HealthSettingsPane />
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
    readHealthSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults: tracking on, every 50 min for 7 breaks, 8 glasses, box breathing', async () => {
    renderPane();
    await flush();
    expect(
      screen.getByRole('switch', { name: 'Track sitting and remind me to take breaks' }),
    ).toBeChecked();
    expect(screen.getByRole('slider', { name: 'Remind me every' })).toHaveValue('50');
    expect(screen.getByText('50 min')).toBeInTheDocument();
    expect(screen.getByText(/Sets a goal of 7 breaks a day/)).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Water goal' })).toHaveValue('8');
    expect(screen.getByText('8 glasses')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Box 4-4-4-4' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Relax 4-7-8' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Wind down in the evening' })).not.toBeChecked();
    expect(screen.queryByRole('slider', { name: 'From' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Warn me about loud headphones' })).toBeChecked();
  });

  it('writes the switches, the sliders and the pattern into the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(
      screen.getByRole('switch', { name: 'Track sitting and remind me to take breaks' }),
    );
    await flush();
    expect(saved().enabled).toBe(false);

    nudge(screen.getByRole('slider', { name: 'Remind me every' }), 'ArrowRight');
    await flush();
    expect(saved().breakEveryMin).toBe(55);
    expect(screen.getByText('55 min')).toBeInTheDocument();
    expect(screen.getByText(/Sets a goal of 6 breaks a day/)).toBeInTheDocument();

    nudge(screen.getByRole('slider', { name: 'Water goal' }), 'ArrowLeft');
    await flush();
    expect(saved().waterGoal).toBe(7);

    fireEvent.click(screen.getByRole('radio', { name: 'Relax 4-7-8' }));
    await flush();
    expect(saved().breathePattern).toBe('relax');

    fireEvent.click(screen.getByRole('switch', { name: 'Warn me about loud headphones' }));
    await flush();
    expect(saved().hearingWarning).toBe(false);
  });

  it('reveals the wind-down hour once the evening toggle is on, from 9 pm', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Wind down in the evening' }));
    await flush();
    expect(saved().windDownHour).toBe(21);
    const hour = screen.getByRole('slider', { name: 'From' });
    expect(hour).toHaveValue('21');
    nudge(hour, 'ArrowLeft');
    await flush();
    expect(saved().windDownHour).toBe(20);

    fireEvent.click(screen.getByRole('switch', { name: 'Wind down in the evening' }));
    await flush();
    expect(saved().windDownHour).toBeNull();
    expect(screen.queryByRole('slider', { name: 'From' })).not.toBeInTheDocument();
  });

  it('resets today through a command and says so', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'reset' });
    expect(screen.getByRole('status')).toHaveTextContent('Today is reset.');
    expect(useHealthStore.getState().snapshot?.today.water).toBe(0);
  });

  it('clears the history only after a confirmation', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByText('Clear the whole history?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.healthCommand).not.toHaveBeenCalled();
    expect(screen.queryByText('Clear the whole history?')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await flush();
    expect(ipc.healthCommand).toHaveBeenCalledWith({ kind: 'clearHistory' });
    expect(screen.getByRole('status')).toHaveTextContent('History cleared.');
  });

  it('keeps quiet when a command fails', async () => {
    ipc.healthCommand.mockResolvedValue({
      status: 'error',
      error: { code: 'platform.os', message: 'busy' },
    });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await flush();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
