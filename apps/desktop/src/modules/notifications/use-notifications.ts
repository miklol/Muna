import {
  commands,
  events,
  type IpcError,
  type NotificationsCommand,
  type NotificationsSettingsPage,
} from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { pendingKey, useNotificationsStore } from './notifications-store';

/**
 * Mirrors the Rust notifications service into `useNotificationsStore` while the caller is
 * mounted: one `get_notifications_snapshot` round trip, then `NotificationsChanged`. Unlistens
 * on unmount so a closed panel costs nothing (PRD performance budget).
 */
export function useNotificationsSubscription(): void {
  const setSnapshot = useNotificationsStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.notificationsChanged
      .listen((event) => {
        setSnapshot(event.payload.snapshot);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .getNotificationsSnapshot()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

const isIpcError = (value: unknown): value is IpcError =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof value.code === 'string' &&
  'message' in value &&
  typeof value.message === 'string';

/**
 * Sends a `NotificationsCommand`, marks what it is about pending until Windows answers, and
 * keeps a refusal beside it when Windows says no. The snapshot the command returns is applied;
 * the `NotificationsChanged` that follows says the same. A notification that has gone by the
 * time *Open* or *Dismiss* reaches Rust answers `platform.notFound`; the list is re-read then,
 * so a stale card leaves instead of staying with a refusal under it.
 */
export function useNotificationsCommand(): (command: NotificationsCommand) => void {
  const { setSnapshot, begin, settle } = useNotificationsStore.getState();
  return useCallback(
    (command: NotificationsCommand) => {
      const key = pendingKey(command);
      if (key !== null) begin(key);
      void commands
        .notificationsCommand(command)
        .then(async (result) => {
          if (result.status === 'ok') {
            setSnapshot(result.data);
            if (key !== null) settle(key, null);
            return;
          }
          if (key !== null) settle(key, result.error);
          if (result.error.code === 'platform.notFound' && command.kind !== 'requestAccess') {
            const refreshed = await commands.notificationsCommand({ kind: 'refresh' });
            if (refreshed.status === 'ok') setSnapshot(refreshed.data);
          }
        })
        .catch((reason: unknown) => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands and nothing is pending.
          if (key !== null) settle(key, isIpcError(reason) ? reason : null);
        });
    },
    [setSnapshot, begin, settle],
  );
}

/**
 * Opens one of the Windows Settings pages the module points at, through Rust (the webview
 * never launches a URI itself). Outside Tauri there is nothing to open.
 */
export const openWindowsSettings = (page: NotificationsSettingsPage): void => {
  void commands.notificationsOpenSettings(page).catch(() => {
    // Tests and Storybook.
  });
};
