import type { IpcError, ScreenTimeCommand, ScreenTimeSnapshot, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readScreenTimeSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { sampleSnapshot } from './sample-snapshot';
import { useScreenTimeStore } from './screen-time-store';
import { ScreenTimeSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getScreenTimeSnapshot: vi.fn<() => Promise<IpcResult<ScreenTimeSnapshot>>>(),
  screenTimeWatch: vi.fn<(watching: boolean) => Promise<void>>(),
  screenTimeCommand:
    vi.fn<(command: ScreenTimeCommand) => Promise<IpcResult<ScreenTimeSnapshot>>>(),
  screenTimeExport: vi.fn<(title: string) => Promise<IpcResult<string | null>>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten from outside Tauri.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getScreenTimeSnapshot: ipc.getScreenTimeSnapshot,
    screenTimeWatch: ipc.screenTimeWatch,
    screenTimeCommand: ipc.screenTimeCommand,
    screenTimeExport: ipc.screenTimeExport,
  },
  events: { screenTimeChanged: { listen: ipc.listen } },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('ScreenTimeSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useScreenTimeStore.setState({ snapshot: null, receivedAt: 0 });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getScreenTimeSnapshot
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: sampleSnapshot() });
    ipc.screenTimeWatch.mockReset().mockResolvedValue(undefined);
    ipc.screenTimeCommand.mockReset().mockImplementation((command) =>
      Promise.resolve({
        status: 'ok',
        data: sampleSnapshot({
          excluded:
            command.kind === 'include'
              ? sampleSnapshot().excluded.filter((app) => app.exe !== command.exe)
              : sampleSnapshot().excluded,
          apps: command.kind === 'clearHistory' ? [] : sampleSnapshot().apps,
        }),
      }),
    );
    ipc.screenTimeExport.mockReset();
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
          <ScreenTimeSettingsPane />
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
    readScreenTimeSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the counting switches at their defaults and the excluded apps', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Count screen time' })).toBeChecked();
    expect(screen.getByText('5 minutes')).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Pause after' })).toHaveValue('5');
    expect(screen.getByRole('slider', { name: 'Day starts at' })).toHaveValue('0');
    expect(screen.getByText('KeePass')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Include KeePass' })).toBeEnabled();
  });

  it('writes the switches into the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Count screen time' }));
    await flush();
    expect(saved().enabled).toBe(false);

    const idle = screen.getByRole('slider', { name: 'Pause after' });
    fireEvent.keyDown(idle, { key: 'ArrowRight' });
    fireEvent.keyUp(idle, { key: 'ArrowRight' });
    await flush();
    expect(saved().idleMinutes).toBe(6);
    expect(screen.getByText('6 minutes')).toBeInTheDocument();

    const reset = screen.getByRole('slider', { name: 'Day starts at' });
    fireEvent.keyDown(reset, { key: 'ArrowRight' });
    fireEvent.keyUp(reset, { key: 'ArrowRight' });
    await flush();
    expect(saved().dayResetHour).toBe(1);
  });

  it('includes an excluded app again through a command', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Include KeePass' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenCalledWith({ kind: 'include', exe: 'keepass.exe' });
    expect(screen.queryByText('KeePass')).not.toBeInTheDocument();
    expect(
      screen.getByText('No excluded apps. Exclude one from its details in the panel.'),
    ).toBeInTheDocument();
  });

  it('exports a CSV and says where it went; a dismissed picker says nothing', async () => {
    renderPane();
    await flush();
    ipc.screenTimeExport.mockResolvedValue({ status: 'ok', data: null });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await flush();
    expect(ipc.screenTimeExport).toHaveBeenCalledWith('Choose a folder for the export');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    ipc.screenTimeExport.mockResolvedValue({
      status: 'ok',
      data: 'D:\\exports\\muna-screen-time-2026-09-29.csv',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Saved to D:\\exports\\muna-screen-time-2026-09-29.csv',
    );

    ipc.screenTimeExport.mockResolvedValue({
      status: 'error',
      error: { code: 'screenTime.io', message: 'denied' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The file could not be written. Choose another folder and try again.',
    );
  });

  it('clears the history only after a confirmation', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByText('Delete all screen time history?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(ipc.screenTimeCommand).not.toHaveBeenCalledWith({ kind: 'clearHistory' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await flush();
    expect(ipc.screenTimeCommand).toHaveBeenCalledWith({ kind: 'clearHistory' });
    expect(screen.queryByText('Delete all screen time history?')).not.toBeInTheDocument();
  });
});
