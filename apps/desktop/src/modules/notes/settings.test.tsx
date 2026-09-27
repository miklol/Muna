import type { IpcError, NotesSnapshot, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readNotesSettings, writeNotesSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useNotesStore } from './notes-store';
import { NotesSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getNotesSnapshot: vi.fn<() => Promise<IpcResult<NotesSnapshot>>>(),
  notesPickFolder: vi.fn<(title: string) => Promise<IpcResult<string | null>>>(),
  notesRevealFolder: vi.fn<() => Promise<IpcResult<null>>>(),
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
    getNotesSnapshot: ipc.getNotesSnapshot,
    notesPickFolder: ipc.notesPickFolder,
    notesRevealFolder: ipc.notesRevealFolder,
  },
  events: { notesChanged: { listen: ipc.listen } },
}));

const DEFAULT_FOLDER = 'C:\\Users\\sam\\AppData\\Roaming\\Muna\\notes';

const snapshot = (overrides: Partial<NotesSnapshot> = {}): NotesSnapshot => ({
  folder: DEFAULT_FOLDER,
  defaultFolder: true,
  notes: [],
  inboxId: null,
  problem: null,
  ...overrides,
});

const vaultSettings = (): Settings =>
  writeNotesSettings(defaultSettings(), {
    ...readNotesSettings(defaultSettings()),
    folder: 'E:\\Vault',
  });

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('NotesSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useNotesStore.setState({ snapshot: null, receivedAt: 0, quickNotePending: false });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getNotesSnapshot.mockReset().mockResolvedValue({ status: 'ok', data: snapshot() });
    ipc.notesPickFolder.mockReset();
    ipc.notesRevealFolder.mockReset().mockResolvedValue({ status: 'ok', data: null });
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
          <NotesSettingsPane />
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

  const saved = () => readNotesSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the default folder Rust reports, with Change and Open folder but no way back to it', async () => {
    renderPane();
    await flush();
    expect(screen.getByText(/Plain Markdown files, one per note/)).toBeInTheDocument();
    expect(screen.getByText(`Default folder · ${DEFAULT_FOLDER}`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Use the default folder' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Write a quick note')).toBeInTheDocument();
    expect(screen.getByText(/Set a shortcut for it under Keyboard shortcuts/)).toBeInTheDocument();
  });

  it('writes the picked folder into the settings document and offers the default again', async () => {
    renderPane();
    await flush();
    ipc.notesPickFolder.mockResolvedValue({ status: 'ok', data: 'E:\\Vault' });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await flush();
    expect(ipc.notesPickFolder).toHaveBeenCalledWith('Choose a notes folder');
    expect(saved().folder).toBe('E:\\Vault');
    expect(screen.getByText('E:\\Vault')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use the default folder' }));
    await flush();
    expect(saved().folder).toBeNull();
  });

  it('changes nothing when the picker is dismissed', async () => {
    renderPane();
    await flush();
    ipc.notesPickFolder.mockResolvedValue({ status: 'ok', data: null });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await flush();
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('opens the folder through Rust', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await flush();
    expect(ipc.notesRevealFolder).toHaveBeenCalledTimes(1);
  });

  it('says when a chosen folder cannot be found right now', async () => {
    cacheSettings(queryClient, vaultSettings());
    ipc.getNotesSnapshot.mockResolvedValue({
      status: 'ok',
      data: snapshot({ folder: 'E:\\Vault', defaultFolder: false, problem: 'missing' }),
    });
    renderPane();
    await flush();
    expect(screen.getByText('E:\\Vault')).toBeInTheDocument();
    expect(screen.getByText('This folder cannot be found right now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use the default folder' })).toBeEnabled();
  });
});
