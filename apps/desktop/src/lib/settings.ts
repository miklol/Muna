import type { Settings } from '@muna/contracts';
import { commands, events } from '@muna/contracts';
import { type QueryClient, queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export const settingsQueryKey = ['settings'] as const;

/** The settings document as Rust holds it; refreshed by `SettingsChanged`, never polled. */
export const settingsQueryOptions = queryOptions({
  queryKey: settingsQueryKey,
  queryFn: () => commands.getSettings(),
});

/** The current document, or `undefined` before the first read (and outside Tauri). */
export function useSettings(): Settings | undefined {
  return useQuery(settingsQueryOptions).data;
}

/** Writes a document into the cache: the optimistic path and the event path share it. */
export const cacheSettings = (queryClient: QueryClient, settings: Settings): void => {
  queryClient.setQueryData(settingsQueryKey, settings);
};

/**
 * Applies a change straight away and asks Rust to persist it (fire-and-forget, for the notch
 * window's own edits such as reordering the module bar). Should Rust refuse, the cache is
 * dropped so the next read shows what was actually saved.
 */
export const persistSettings = (queryClient: QueryClient, settings: Settings): void => {
  cacheSettings(queryClient, settings);
  const refetch = () => {
    void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
  };
  Promise.resolve()
    .then(() => commands.updateSettings(settings))
    .then((result) => {
      if (result.status === 'error') {
        refetch();
      }
    })
    .catch(refetch);
};

/**
 * Mirrors `SettingsChanged` into the query cache for the lifetime of the window, so both
 * windows see a change the moment Rust has persisted it (the settings window's own writes,
 * an import, or Windows refusing autostart). Outside Tauri the subscription fails quietly.
 */
export function useSettingsSubscription(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    Promise.resolve()
      .then(() =>
        events.settingsChanged.listen((event) => {
          cacheSettings(queryClient, event.payload.settings);
        }),
      )
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Not running inside Tauri (tests, Storybook): settings never change underneath us.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [queryClient]);
}
