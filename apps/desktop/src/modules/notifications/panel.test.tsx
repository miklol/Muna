import type {
  IpcError,
  NotificationGroup,
  NotificationsCommand,
  NotificationsSettingsPage,
  NotificationsSnapshot,
  NotificationView,
  Settings,
} from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import {
  defaultSettings,
  readNotificationsSettings,
  writeNotificationsSettings,
} from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../../lib/settings';
import { useNotificationsStore } from './notifications-store';
import { cardTitle, errorKey, initialOf, NotificationsPanel } from './panel';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: NotificationsSnapshot }>[] = [];
  return {
    getNotificationsSnapshot: vi.fn<() => Promise<NotificationsSnapshot>>(),
    notificationsCommand:
      vi.fn<(command: NotificationsCommand) => Promise<IpcResult<NotificationsSnapshot>>>(),
    notificationsOpenSettings: vi.fn<(page: NotificationsSettingsPage) => Promise<null>>(),
    updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
    getSettings: vi.fn<() => Promise<Settings>>(),
    listen: vi.fn((callback: Listener<{ snapshot: NotificationsSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: NotificationsSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getNotificationsSnapshot: ipc.getNotificationsSnapshot,
    notificationsCommand: ipc.notificationsCommand,
    notificationsOpenSettings: ipc.notificationsOpenSettings,
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
  },
  events: {
    notificationsChanged: { listen: ipc.listen },
  },
}));

const NOW_MS = Date.UTC(2025, 5, 12, 10, 30);
const MINUTE_MS = 60_000;

const view = (
  id: number,
  appId: string,
  overrides: Partial<Omit<NotificationView, 'id' | 'appId'>> = {},
): NotificationView => ({
  id,
  appId,
  title: `Title ${String(id)}`,
  body: `Body ${String(id)}`,
  createdAtMs: NOW_MS - 5 * MINUTE_MS,
  unread: false,
  ...overrides,
});

const mailInvoice = view(1, 'mail', {
  title: 'Invoice',
  body: '',
  createdAtMs: NOW_MS - 3 * 60 * MINUTE_MS,
});
const mail: NotificationGroup = {
  appId: 'mail',
  appName: 'Mail',
  logo: 'data:image/png;base64,AAAA',
  muted: false,
  notifications: [
    view(3, 'mail', { title: 'Lunch?', body: 'Are you free at noon', unread: true }),
    mailInvoice,
  ],
};
const chat: NotificationGroup = {
  appId: 'chat',
  appName: 'Chat',
  logo: null,
  muted: false,
  notifications: [view(2, 'chat', { title: '', body: 'ping', unread: true })],
};

const snapshot = (overrides: Partial<NotificationsSnapshot> = {}): NotificationsSnapshot => ({
  access: 'allowed',
  delivery: 'push',
  focusActive: false,
  unread: 2,
  groups: [mail, chat],
  ...overrides,
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

const group = (appName: string) => screen.getByRole('region', { name: appName });

const card = (title: string) => {
  const found = screen.getByText(title).closest('.ntf-card');
  if (found === null) throw new Error(`no card titled ${title}`);
  return found as HTMLElement;
};

describe('errorKey, cardTitle and initialOf', () => {
  const t = i18n.t.bind(i18n);

  it('maps the platform error codes and falls back to a retry line', () => {
    expect(errorKey({ code: 'platform.notFound', message: '' })).toBe(
      'notifications.error.notFound',
    );
    expect(errorKey({ code: 'platform.accessDenied', message: '' })).toBe(
      'notifications.error.accessDenied',
    );
    expect(errorKey({ code: 'platform.unsupported', message: '' })).toBe(
      'notifications.error.unsupported',
    );
    expect(errorKey({ code: 'platform.os', message: '' })).toBe('notifications.error.os');
  });

  it('names an untitled toast and takes the first letter of a sender', () => {
    expect(cardTitle(view(1, 'mail', { title: 'Hello' }), t)).toBe('Hello');
    expect(cardTitle(view(1, 'mail', { title: '' }), t)).toBe('Notification');
    expect(initialOf('mail app', 'en')).toBe('M');
    expect(initialOf('  ', 'en')).toBe('?');
  });
});

describe('NotificationsPanel', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useNotificationsStore.setState({
      snapshot: null,
      fresh: new Set(),
      pending: new Set(),
      errors: {},
    });
    ipc.getNotificationsSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.notificationsCommand
      .mockReset()
      .mockImplementation(() => Promise.resolve({ status: 'ok', data: snapshot({ unread: 0 }) }));
    ipc.notificationsOpenSettings.mockReset().mockResolvedValue(null);
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.listen.mockClear();
  });

  afterEach(async () => {
    cleanup();
    // Let Motion's frame loop run the frame it scheduled before the timers go real.
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });
    vi.useRealTimers();
  });

  const renderPanel = () =>
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <NotificationsPanel />
        </QueryClientProvider>
      </I18nextProvider>,
    );

  const commandsSent = () => ipc.notificationsCommand.mock.calls.map(([command]) => command);

  it('subscribes, groups by sender with logo or initial, marks everything read, and unlistens', async () => {
    const rendered = renderPanel();
    await flush();
    expect(ipc.getNotificationsSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);
    // Seeing the panel is reading the Action Center.
    expect(commandsSent()).toEqual([{ kind: 'markRead' }]);

    const list = screen.getByRole('list', { name: 'Notifications by app' });
    const sections = within(list).getAllByRole('region');
    expect(sections.map((section) => section.getAttribute('aria-label'))).toEqual(['Mail', 'Chat']);
    expect(within(group('Mail')).getByText('2 notifications')).toBeInTheDocument();
    expect(group('Mail').querySelector('img.ntf-logo')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    );
    expect(group('Chat').querySelector('.ntf-logo--initial')).toHaveTextContent('C');
    expect(within(group('Chat')).getByText('1 notification')).toBeInTheDocument();

    // Cards: title, body, relative time; an untitled toast is still a notification.
    expect(within(card('Lunch?')).getByText('Are you free at noon')).toBeInTheDocument();
    expect(within(card('Lunch?')).getByText('5 minutes ago')).toBeInTheDocument();
    expect(within(card('Invoice')).getByText('3 hours ago')).toBeInTheDocument();
    expect(within(group('Chat')).getByText('Notification')).toBeInTheDocument();
    expect(within(card('Lunch?')).getByRole('button', { name: 'Open Lunch?' })).toBeEnabled();
    expect(within(card('Lunch?')).getByRole('button', { name: 'Dismiss Lunch?' })).toBeEnabled();

    rendered.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(useNotificationsStore.getState().fresh.size).toBe(0);
    // The one timer left is TanStack Query's cache garbage collection for the settings
    // document the panel read (to mute); nothing of the panel's own is still ticking.
    expect(vi.getTimerCount()).toBe(1);
    queryClient.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a dot on what was unread until the panel closes and counts it in the header', async () => {
    renderPanel();
    await flush();
    expect(screen.getByText('2 unread')).toBeInTheDocument();
    expect(within(card('Lunch?')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    expect(within(card('Invoice')).queryByRole('img', { name: 'Unread' })).toBeNull();

    // Windows now says everything is read; the dots stay while the panel is open.
    act(() => {
      ipc.emit(
        snapshot({
          unread: 0,
          groups: [
            { ...mail, notifications: mail.notifications.map((n) => ({ ...n, unread: false })) },
            { ...chat, notifications: chat.notifications.map((n) => ({ ...n, unread: false })) },
          ],
        }),
      );
    });
    await flush();
    expect(screen.getByText('2 unread')).toBeInTheDocument();
    expect(within(card('Lunch?')).getByRole('img', { name: 'Unread' })).toBeInTheDocument();
    // Only one markRead: nothing new arrived.
    expect(commandsSent()).toEqual([{ kind: 'markRead' }]);
  });

  it('dismisses and opens a card, showing it pending until Windows answers', async () => {
    let answer: ((result: IpcResult<NotificationsSnapshot>) => void) | null = null;
    ipc.notificationsCommand.mockImplementation((command) => {
      if (command.kind === 'markRead') {
        return Promise.resolve({ status: 'ok', data: snapshot({ unread: 0 }) });
      }
      return new Promise((resolve) => {
        answer = resolve;
      });
    });
    renderPanel();
    await flush();

    fireEvent.click(within(card('Lunch?')).getByRole('button', { name: 'Dismiss Lunch?' }));
    await flush();
    expect(commandsSent()).toContainEqual({ kind: 'dismiss', id: 3 });
    expect(within(card('Lunch?')).getByRole('button', { name: 'Dismiss Lunch?' })).toBeDisabled();
    expect(within(card('Lunch?')).getByRole('button', { name: 'Open Lunch?' })).toBeDisabled();
    expect(within(card('Invoice')).getByRole('button', { name: 'Open Invoice' })).toBeEnabled();

    const without = snapshot({
      unread: 0,
      groups: [{ ...mail, notifications: [mailInvoice] }, chat],
    });
    act(() => {
      answer?.({ status: 'ok', data: without });
    });
    await flush();
    expect(screen.queryByText('Lunch?')).toBeNull();
    expect(within(group('Mail')).getByText('1 notification')).toBeInTheDocument();
    expect(useNotificationsStore.getState().pending.size).toBe(0);

    fireEvent.click(within(card('Invoice')).getByRole('button', { name: 'Open Invoice' }));
    await flush();
    expect(commandsSent()).toContainEqual({ kind: 'open', id: 1 });
  });

  it('says in place when Windows refuses, and re-reads the list when the toast has gone', async () => {
    ipc.notificationsCommand.mockImplementation((command) => {
      switch (command.kind) {
        case 'open':
          return Promise.resolve({
            status: 'error',
            error: { code: 'platform.accessDenied', message: 'access denied' },
          });
        case 'dismiss':
          return Promise.resolve({
            status: 'error',
            error: { code: 'platform.notFound', message: 'gone' },
          });
        case 'refresh':
          return Promise.resolve({
            status: 'ok',
            data: snapshot({ unread: 0, groups: [chat] }),
          });
        default:
          return Promise.resolve({ status: 'ok', data: snapshot({ unread: 0 }) });
      }
    });
    renderPanel();
    await flush();

    fireEvent.click(within(card('Invoice')).getByRole('button', { name: 'Open Invoice' }));
    await flush();
    expect(within(card('Invoice')).getByRole('alert')).toHaveTextContent(
      'Windows would not allow it',
    );
    expect(within(card('Invoice')).getByRole('button', { name: 'Open Invoice' })).toBeEnabled();
    expect(commandsSent()).not.toContainEqual({ kind: 'refresh' });

    fireEvent.click(within(card('Lunch?')).getByRole('button', { name: 'Dismiss Lunch?' }));
    await flush();
    expect(commandsSent()).toContainEqual({ kind: 'refresh' });
    expect(screen.queryByRole('region', { name: 'Mail' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(useNotificationsStore.getState().errors).toEqual({});
  });

  it('clears one sender and everything, disabling what is in flight', async () => {
    renderPanel();
    await flush();

    fireEvent.click(within(group('Chat')).getByRole('button', { name: 'Clear Chat' }));
    await flush();
    expect(commandsSent()).toContainEqual({ kind: 'dismissApp', appId: 'chat' });

    ipc.notificationsCommand.mockImplementation((command) =>
      command.kind === 'clear'
        ? new Promise(() => {
            // Windows never answers in this test.
          })
        : Promise.resolve({ status: 'ok', data: snapshot({ unread: 0 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await flush();
    expect(commandsSent()).toContainEqual({ kind: 'clear' });
    expect(screen.getByRole('button', { name: 'Clearing…' })).toBeDisabled();
  });

  it('mutes and unmutes a sender through the settings document', async () => {
    renderPanel();
    await flush();
    fireEvent.click(within(group('Mail')).getByRole('button', { name: 'Mute Mail' }));
    await flush();
    const saved = ipc.updateSettings.mock.lastCall?.[0];
    expect(saved).toBeDefined();
    expect(readNotificationsSettings(saved ?? defaultSettings()).mutedApps).toEqual(['mail']);

    // Rust re-emits its snapshot with the sender muted; the row says so and offers unmute.
    // (Nothing is unread, so the panel has no reason to mark read again.)
    cacheSettings(
      queryClient,
      writeNotificationsSettings(defaultSettings(), {
        arrivalNotices: true,
        showUnreadInStrip: true,
        mutedApps: ['mail'],
      }),
    );
    act(() => {
      ipc.emit(snapshot({ unread: 0, groups: [{ ...mail, muted: true }, chat] }));
    });
    await flush();
    expect(within(group('Mail')).getByText('Muted')).toBeInTheDocument();
    fireEvent.click(within(group('Mail')).getByRole('button', { name: 'Unmute Mail' }));
    await flush();
    expect(
      readNotificationsSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings())
        .mutedApps,
    ).toEqual([]);
  });

  it('points at Windows focus settings while a focus session is on', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue(
      snapshot({ focusActive: true, unread: 0, groups: [] }),
    );
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Focus on' }));
    expect(ipc.notificationsOpenSettings).toHaveBeenCalledWith('focus');
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('says when the Action Center is empty and sends no markRead', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue(snapshot({ unread: 0, groups: [] }));
    renderPanel();
    await flush();
    expect(screen.getByText('No notifications')).toBeInTheDocument();
    expect(screen.getByText('New ones show here as they arrive.')).toBeInTheDocument();
    expect(commandsSent()).toEqual([]);
  });

  it('asks for consent when Windows has not been asked, and shows a refusal beside Allow', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue(
      snapshot({ access: 'unspecified', delivery: null, unread: 0, groups: [] }),
    );
    let answer: ((result: IpcResult<NotificationsSnapshot>) => void) | null = null;
    ipc.notificationsCommand.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Let Muna show your notifications')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await flush();
    expect(commandsSent()).toEqual([{ kind: 'requestAccess' }]);
    expect(screen.getByRole('button', { name: 'Asking Windows…' })).toBeDisabled();

    act(() => {
      answer?.({
        status: 'error',
        error: { code: 'platform.os', message: 'the prompt failed' },
      });
    });
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong; try again');
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();

    // Consent given: the list takes over.
    act(() => {
      ipc.emit(snapshot());
    });
    await flush();
    expect(screen.getByRole('list', { name: 'Notifications by app' })).toBeInTheDocument();
    expect(commandsSent()).toContainEqual({ kind: 'markRead' });
  });

  it('offers Windows Settings and a re-check when access was refused', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue(
      snapshot({ access: 'denied', delivery: null, unread: 0, groups: [] }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Notifications are turned off for Muna')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Windows Settings' }));
    expect(ipc.notificationsOpenSettings).toHaveBeenCalledWith('privacy');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await flush();
    expect(commandsSent()).toEqual([{ kind: 'requestAccess' }]);
  });

  it('explains a Windows without a listener and offers nothing to press', async () => {
    ipc.getNotificationsSnapshot.mockResolvedValue(
      snapshot({ access: 'unavailable', delivery: null, unread: 0, groups: [] }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Notifications are not available')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(commandsSent()).toEqual([]);
  });
});
