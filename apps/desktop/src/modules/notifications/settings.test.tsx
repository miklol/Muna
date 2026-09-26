import type {
  NotificationsCommand,
  NotificationsSettingsPage,
  NotificationsSnapshot,
  Settings,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readNotificationsSettings,
  writeNotificationsSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useNotificationsStore } from './notifications-store';
import { NotificationsSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getNotificationsSnapshot: vi.fn<() => Promise<NotificationsSnapshot>>(),
  notificationsCommand:
    vi.fn<(command: NotificationsCommand) => Promise<IpcResult<NotificationsSnapshot>>>(),
  notificationsOpenSettings: vi.fn<(page: NotificationsSettingsPage) => Promise<null>>(),
  listen: vi.fn(() =>
    Promise.resolve(() => {
      // Nothing to unlisten: the pane never receives an event in these tests.
    }),
  ),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getNotificationsSnapshot: ipc.getNotificationsSnapshot,
    notificationsCommand: ipc.notificationsCommand,
    notificationsOpenSettings: ipc.notificationsOpenSettings,
  },
  events: {
    notificationsChanged: { listen: ipc.listen },
  },
}));

const allowed: NotificationsSnapshot = {
  access: 'allowed',
  delivery: 'push',
  focusActive: false,
  unread: 0,
  groups: [
    {
      appId: 'mail',
      appName: 'Mail',
      logo: null,
      muted: true,
      notifications: [],
    },
  ],
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('NotificationsSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useNotificationsStore.setState({
      snapshot: null,
      fresh: new Set(),
      pending: new Set(),
      errors: {},
    });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getNotificationsSnapshot.mockReset().mockResolvedValue(allowed);
    ipc.notificationsCommand
      .mockReset()
      .mockImplementation(() => Promise.resolve({ status: 'ok', data: allowed }));
    ipc.notificationsOpenSettings.mockReset().mockResolvedValue(null);
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
          <NotificationsSettingsPane />
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
    readNotificationsSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows the defaults, where access stands, and instant delivery', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Announce new notifications' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Show unread in the strip' })).toBeChecked();
    expect(
      screen.getByText('Allowed. Muna reads the Action Center on this PC only.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Instant')).toBeInTheDocument();
    expect(screen.getByText('No muted apps.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Windows Settings' }));
    expect(ipc.notificationsOpenSettings).toHaveBeenCalledWith('privacy');
  });

  it('saves each strip switch at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Announce new notifications' }));
    await flush();
    expect(saved().arrivalNotices).toBe(false);
    expect(saved().showUnreadInStrip).toBe(true);

    fireEvent.click(screen.getByRole('switch', { name: 'Show unread in the strip' }));
    await flush();
    expect(saved().showUnreadInStrip).toBe(false);
    expect(saved().arrivalNotices).toBe(false);
  });

  it('lists muted senders by name and unmutes them', async () => {
    cacheSettings(
      queryClient,
      writeNotificationsSettings(defaultSettings(), {
        arrivalNotices: true,
        showUnreadInStrip: true,
        mutedApps: ['mail', 'gone.app'],
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByText('Mail')).toBeInTheDocument();
    // A sender not in the Action Center right now still shows, by its id.
    expect(screen.getByText('gone.app')).toBeInTheDocument();
    expect(screen.queryByText('No muted apps.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Unmute Mail' }));
    await flush();
    expect(saved().mutedApps).toEqual(['gone.app']);
    expect(screen.queryByText('Mail')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unmute gone.app' })).toBeInTheDocument();
  });

  it('explains polling on a build without package identity', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue({ ...allowed, delivery: 'polling' });
    renderPane();
    await flush();
    expect(screen.getByText('Checked every second')).toBeInTheDocument();
    expect(screen.getByText(/no package identity/)).toBeInTheDocument();
  });

  it('offers Allow before Windows has been asked and disables it while asking', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue({
      ...allowed,
      access: 'unspecified',
      delivery: null,
      groups: [],
    });
    ipc.notificationsCommand.mockImplementation(
      () =>
        new Promise(() => {
          // Windows never answers in this test.
        }),
    );
    renderPane();
    await flush();
    expect(screen.getByText('Windows has not been asked yet.')).toBeInTheDocument();
    expect(screen.queryByText('Instant')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await flush();
    expect(ipc.notificationsCommand).toHaveBeenCalledWith({ kind: 'requestAccess' });
    expect(screen.getByRole('button', { name: 'Asking Windows…' })).toBeDisabled();
  });

  it('offers Windows Settings and a re-check when access was refused', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue({
      ...allowed,
      access: 'denied',
      delivery: null,
      groups: [],
    });
    renderPane();
    await flush();
    expect(screen.getByText('Turned off in Windows Settings.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Windows Settings' }));
    expect(ipc.notificationsOpenSettings).toHaveBeenCalledWith('privacy');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await flush();
    expect(ipc.notificationsCommand).toHaveBeenCalledWith({ kind: 'requestAccess' });
  });

  it('says when this Windows has no listener and offers nothing to press for access', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue({
      ...allowed,
      access: 'unavailable',
      delivery: null,
      groups: [],
    });
    renderPane();
    await flush();
    expect(screen.getByText('Not available on this Windows.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Windows Settings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow' })).toBeNull();
  });
});
