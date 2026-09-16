import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createQueryClient } from '../lib/query-client';
import { cacheSettings, settingsQueryKey } from '../lib/settings';
import { SAVE_DEBOUNCE_MS, SettingsEditorProvider, useSettingsEditor } from './settings-editor';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { updateSettings: ipc.updateSettings },
}));

/** Exposes the editor as buttons: one immediate change, one debounced slider-style change. */
function Probe() {
  const { settings, update, saveError } = useSettingsEditor();
  return (
    <>
      <output data-testid="offset">{settings.shell.defaults.offsetX}</output>
      <output data-testid="error">{saveError === null ? 'none' : saveError.message}</output>
      <button
        type="button"
        onClick={() => {
          update((current) => ({
            ...current,
            general: { ...current.general, launchAtLogin: true },
          }));
        }}
      >
        immediate
      </button>
      <button
        type="button"
        onClick={() => {
          update(
            (current) => ({
              ...current,
              shell: {
                ...current.shell,
                defaults: {
                  ...current.shell.defaults,
                  offsetX: current.shell.defaults.offsetX + 1,
                },
              },
            }),
            { debounced: true },
          );
        }}
      >
        nudge
      </button>
    </>
  );
}

/** Lets the mutation and the query cache's batched notifications run, without reaching the gc timer. */
const flushIpc = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('SettingsEditorProvider', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderEditor = () => {
    const Host = () => {
      const settings = queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <Probe />
        </SettingsEditorProvider>
      );
    };
    render(
      <QueryClientProvider client={queryClient}>
        <Host />
      </QueryClientProvider>,
    );
  };

  it('saves a discrete change straight away', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('immediate'));
    // The mutation hands the call to Rust on the next microtask.
    await flushIpc();
    expect(ipc.updateSettings).toHaveBeenCalledTimes(1);
    expect(ipc.updateSettings.mock.calls[0]?.[0].general.launchAtLogin).toBe(true);
    expect(queryClient.getQueryData<Settings>(settingsQueryKey)?.general.launchAtLogin).toBe(true);
  });

  it('coalesces a run of debounced changes into one save with the final value', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('nudge'));
    fireEvent.click(screen.getByText('nudge'));
    fireEvent.click(screen.getByText('nudge'));
    // The cache (and so every pane) already shows the latest value…
    expect(queryClient.getQueryData<Settings>(settingsQueryKey)?.shell.defaults.offsetX).toBe(3);
    // …but Rust has not been asked yet.
    expect(ipc.updateSettings).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    });
    expect(ipc.updateSettings).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(ipc.updateSettings).toHaveBeenCalledTimes(1);
    expect(ipc.updateSettings.mock.calls[0]?.[0].shell.defaults.offsetX).toBe(3);
  });

  it('an immediate change flushes a pending debounced one first', async () => {
    renderEditor();
    fireEvent.click(screen.getByText('nudge'));
    fireEvent.click(screen.getByText('immediate'));
    await flushIpc();
    expect(ipc.updateSettings).toHaveBeenCalledTimes(1);
    const saved = ipc.updateSettings.mock.calls[0]?.[0];
    expect(saved?.shell.defaults.offsetX).toBe(1);
    expect(saved?.general.launchAtLogin).toBe(true);
  });

  it('surfaces a refused save and drops the optimistic document', async () => {
    ipc.updateSettings.mockImplementation(() =>
      Promise.resolve({ status: 'error', error: { code: 'settings.io', message: 'read-only' } }),
    );
    renderEditor();
    fireEvent.click(screen.getByText('immediate'));
    await flushIpc();
    expect(screen.getByTestId('error')).toHaveTextContent('read-only');
    expect(queryClient.getQueryState(settingsQueryKey)?.isInvalidated).toBe(true);
  });
});
