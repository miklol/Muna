import type { Settings, ShelfCommand, ShelfSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readShelfSettings, writeShelfSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { ShelfSettingsPane } from './settings';
import { useShelfStore } from './shelf-store';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getShelfSnapshot: vi.fn<() => Promise<IpcResult<ShelfSnapshot>>>(),
  shelfCommand: vi.fn<(command: ShelfCommand) => Promise<IpcResult<ShelfSnapshot>>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getShelfSnapshot: ipc.getShelfSnapshot,
    shelfCommand: ipc.shelfCommand,
  },
  events: {
    shelfChanged: { listen: ipc.listen },
  },
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const snapshot = (count: number): IpcResult<ShelfSnapshot> => ({
  status: 'ok',
  data: {
    items: Array.from({ length: count }, (_, index) => ({
      id: `s${String(index)}`,
      kind: 'file',
      name: `file-${String(index)}.pdf`,
      extension: 'pdf',
      size: 1_024,
      isFolder: false,
      copied: false,
      missing: false,
      preview: null,
      addedAtMs: index,
    })),
    settings: { copyIntoStorage: false, expiryDays: 0 },
  },
});

describe('ShelfSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useShelfStore.setState({ snapshot: null, selected: [] });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getShelfSnapshot.mockReset().mockResolvedValue(snapshot(3));
    ipc.shelfCommand.mockReset().mockResolvedValue(snapshot(0));
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
          <ShelfSettingsPane />
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

  const saved = () => readShelfSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the storage toggle, the expiry and the count from the document and the snapshot', async () => {
    cacheSettings(
      queryClient,
      writeShelfSettings(defaultSettings(), { copyIntoStorage: true, expiryDays: 7 }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Copy files into Shelf storage' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '7 days' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Never' })).not.toBeChecked();
    expect(screen.getByText('3 items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('saves the toggle and the expiry at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Copy files into Shelf storage' }));
    await flush();
    expect(saved().copyIntoStorage).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '30 days' }));
    await flush();
    expect(saved().expiryDays).toBe(30);
  });

  it('offers a hand-edited expiry as its own choice', async () => {
    cacheSettings(
      queryClient,
      writeShelfSettings(defaultSettings(), { copyIntoStorage: false, expiryDays: 14 }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('radio', { name: '14 days' })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('clears the Shelf through the command and disables the button once empty', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await flush();
    expect(ipc.shelfCommand).toHaveBeenCalledWith({ kind: 'clear' });
    expect(screen.getByText('0 items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  });
});
