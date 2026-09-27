import type { IpcError, Settings, SupportCommand, SupportLink, SupportOutcome, SupportSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readSupportSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { sampleSnapshot } from './sample-snapshot';
import { SupportSettingsPane } from './settings';
import { useSupportStore } from './support-store';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getSupportSnapshot: vi.fn<() => Promise<IpcResult<SupportSnapshot>>>(),
  supportCommand: vi.fn<(command: SupportCommand) => Promise<IpcResult<SupportOutcome>>>(),
  supportOpen: vi.fn<(link: SupportLink) => Promise<IpcResult<null>>>(),
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
    getSupportSnapshot: ipc.getSupportSnapshot,
    supportCommand: ipc.supportCommand,
    supportOpen: ipc.supportOpen,
  },
  events: { supportChanged: { listen: ipc.listen } },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('SupportSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useSupportStore.setState({ snapshot: null });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getSupportSnapshot.mockReset().mockResolvedValue({ status: 'ok', data: sampleSnapshot() });
    ipc.supportCommand.mockReset().mockResolvedValue({ status: 'ok', data: { kind: 'done' } });
    ipc.supportOpen.mockReset().mockResolvedValue({ status: 'ok', data: null });
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
          <SupportSettingsPane />
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
    readSupportSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the channel, the version, the machine and the size of the logs', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('radio', { name: 'Stable' })).toBeChecked();
    expect(screen.getByText(/You have version 0\.3\.0/u)).toBeInTheDocument();
    expect(screen.getByText('Windows 11 Pro (build 26200) · WebView2 140.0.3485.54')).toBeInTheDocument();
    expect(screen.getByText(/^1\.2 MB of logs/u)).toBeInTheDocument();
  });

  it('writes the beta channel into the settings document', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('radio', { name: 'Beta' }));
    await flush();
    expect(saved().channel).toBe('beta');
  });

  it('checks for updates on request only and offers the download when one exists', async () => {
    ipc.supportCommand.mockResolvedValue({
      status: 'ok',
      data: { kind: 'update', available: true, version: '0.4.0', notes: null },
    });
    renderPane();
    await flush();
    expect(ipc.supportCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await flush();
    expect(ipc.supportCommand).toHaveBeenCalledWith({ kind: 'checkUpdates' });
    expect(screen.getByText('Version 0.4.0 is available on GitHub.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Get it' }));
    await flush();
    expect(ipc.supportOpen).toHaveBeenCalledWith('releaseNotes');
  });

  it('says the build is current, and why a check failed', async () => {
    ipc.supportCommand.mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'update', available: false, version: null, notes: null },
    });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await flush();
    expect(screen.getByText('Version 0.3.0 is the latest.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Get it' })).not.toBeInTheDocument();

    ipc.supportCommand.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'support.updater', message: 'offline' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));
    await flush();
    expect(
      screen.getByText('Updates could not be checked. Check your connection and try again.'),
    ).toBeInTheDocument();
  });

  it('saves the bundle, opens the logs folder and runs both repairs through Rust', async () => {
    ipc.supportCommand.mockResolvedValueOnce({
      status: 'ok',
      data: { kind: 'bundle', path: 'D:\\Desktop\\muna-diagnostics-20260927-1030.zip', entries: 4, atMs: 0 },
    });
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Saved muna-diagnostics-20260927-1030.zip');

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const repairs = screen.getAllByRole('button', { name: 'Repair' });
    fireEvent.click(repairs.at(0)!);
    fireEvent.click(repairs.at(1)!);
    await flush();
    expect(ipc.supportCommand.mock.calls.map(([command]) => command.kind)).toEqual([
      'diagnostics',
      'openLogs',
      'repairFlyouts',
      'repairAppBar',
    ]);
    expect(screen.getByRole('status')).toHaveTextContent('Reserved space repaired.');
  });
});
