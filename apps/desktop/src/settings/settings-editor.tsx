import type { Settings } from '@muna/contracts';
import { commands } from '@muna/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef } from 'react';

import { unwrap } from '../lib/ipc';
import { cacheSettings, settingsQueryKey } from '../lib/settings';

/**
 * How long a run of slider changes is coalesced before one `update_settings` call. Not motion:
 * the notch re-places itself on every save, so a drag should not save on every pixel.
 */
export const SAVE_DEBOUNCE_MS = 150;

export type SettingsRecipe = (current: Settings) => Settings;

export interface UpdateOptions {
  /** Coalesces rapid changes (slider drags); the cache still updates immediately. */
  debounced?: boolean;
}

export interface SettingsEditor {
  settings: Settings;
  /** Applies `recipe` to the latest document, shows it at once and saves it (live apply). */
  update: (recipe: SettingsRecipe, options?: UpdateOptions) => void;
  /** The last save that failed, until the next save succeeds. */
  saveError: Error | null;
}

const SettingsEditorContext = createContext<SettingsEditor | null>(null);

interface ProviderProps {
  settings: Settings;
  children: ReactNode;
}

/**
 * Owns the write path of the settings window. Every change is applied to the query cache
 * first (so all panes and the notch preview react immediately), then persisted through
 * `update_settings`; a refused save refetches the document Rust actually holds.
 */
export function SettingsEditorProvider({ settings, children }: ProviderProps) {
  const queryClient = useQueryClient();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useMutation({
    mutationFn: async (next: Settings) => unwrap(await commands.updateSettings(next)),
    onSuccess: (saved) => {
      cacheSettings(queryClient, saved);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQueryKey });
    },
  });
  const { mutate } = save;

  const flush = useCallback(() => {
    if (pending.current !== null) {
      clearTimeout(pending.current);
      pending.current = null;
    }
    const latest = queryClient.getQueryData<Settings>(settingsQueryKey);
    if (latest !== undefined) {
      mutate(latest);
    }
  }, [mutate, queryClient]);

  const update = useCallback(
    (recipe: SettingsRecipe, options?: UpdateOptions) => {
      const current = queryClient.getQueryData<Settings>(settingsQueryKey) ?? settings;
      cacheSettings(queryClient, recipe(current));
      if (options?.debounced === true) {
        if (pending.current !== null) {
          clearTimeout(pending.current);
        }
        pending.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
      } else {
        flush();
      }
    },
    [flush, queryClient, settings],
  );

  useEffect(
    () => () => {
      if (pending.current !== null) {
        clearTimeout(pending.current);
      }
    },
    [],
  );

  return (
    <SettingsEditorContext.Provider value={{ settings, update, saveError: save.error }}>
      {children}
    </SettingsEditorContext.Provider>
  );
}

export function useSettingsEditor(): SettingsEditor {
  const editor = useContext(SettingsEditorContext);
  if (editor === null) {
    throw new Error('useSettingsEditor needs a SettingsEditorProvider');
  }
  return editor;
}
