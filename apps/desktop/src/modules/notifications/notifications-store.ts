import type { IpcError, NotificationsCommand, NotificationsSnapshot } from '@muna/contracts';
import { create } from 'zustand';

/**
 * What a command in flight (or the refusal it met) is about: one notification, one sender,
 * the whole Action Center, or the consent prompt. `null` for commands nothing waits on.
 */
export type PendingKey = `notification:${number}` | `app:${string}` | 'all' | 'access';

export const pendingKey = (command: NotificationsCommand): PendingKey | null => {
  switch (command.kind) {
    case 'dismiss':
    case 'open':
      return `notification:${command.id}`;
    case 'dismissApp':
      return `app:${command.appId}`;
    case 'clear':
      return 'all';
    case 'requestAccess':
      return 'access';
    case 'refresh':
    case 'markRead':
      return null;
  }
};

export interface NotificationsStore {
  /** Last `NotificationsChanged`; `null` until the first snapshot arrives. */
  snapshot: NotificationsSnapshot | null;
  /**
   * Notifications that were unread at some point while the panel has been open. The panel
   * marks everything read the moment it opens, so these keep their dot until it closes and
   * the user can still tell what was new.
   */
  fresh: ReadonlySet<number>;
  /** Commands still waiting on Windows. */
  pending: ReadonlySet<PendingKey>;
  /** The refusal the last command met, by what it was about; cleared by the next attempt. */
  errors: Readonly<Partial<Record<PendingKey, IpcError>>>;
  setSnapshot: (snapshot: NotificationsSnapshot) => void;
  begin: (key: PendingKey) => void;
  settle: (key: PendingKey, error: IpcError | null) => void;
  /** The panel closed: nothing is fresh any more. */
  forgetFresh: () => void;
}

const withoutKey = <T>(
  record: Readonly<Partial<Record<PendingKey, T>>>,
  key: PendingKey,
): Partial<Record<PendingKey, T>> => {
  const { [key]: _dropped, ...rest } = record;
  return rest;
};

const toggled = <T>(set: ReadonlySet<T>, value: T, present: boolean): ReadonlySet<T> => {
  if (set.has(value) === present) return set;
  const next = new Set(set);
  if (present) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
};

/**
 * The notifications module's mirror of the Rust service (docs/modules/notifications.md). Fed
 * by `useNotificationsSubscription` while the panel or the settings pane is mounted; the strip
 * never needs it because the glance and the notices arrive through `StripContentChanged`.
 * Nothing here polls.
 */
export const useNotificationsStore = create<NotificationsStore>()((set) => ({
  snapshot: null,
  fresh: new Set(),
  pending: new Set(),
  errors: {},
  setSnapshot: (snapshot) => {
    set((state) => {
      const listed = new Set<number>();
      const fresh = new Set<number>();
      for (const group of snapshot.groups) {
        for (const view of group.notifications) {
          listed.add(view.id);
          if (view.unread || state.fresh.has(view.id)) fresh.add(view.id);
        }
      }
      // A refusal about a notification that has gone has nothing to sit under.
      const errors = Object.fromEntries(
        Object.entries(state.errors).filter(([key]) => {
          const match = /^notification:(\d+)$/.exec(key);
          return match?.[1] === undefined || listed.has(Number(match[1]));
        }),
      ) as Partial<Record<PendingKey, IpcError>>;
      return { snapshot, fresh, errors };
    });
  },
  begin: (key) => {
    set((state) => ({
      pending: toggled(state.pending, key, true),
      errors: withoutKey(state.errors, key),
    }));
  },
  settle: (key, error) => {
    set((state) => ({
      pending: toggled(state.pending, key, false),
      errors: error === null ? withoutKey(state.errors, key) : { ...state.errors, [key]: error },
    }));
  },
  forgetFresh: () => {
    set((state) => (state.fresh.size === 0 ? {} : { fresh: new Set() }));
  },
}));
