import type { MediaSession, MediaSnapshot, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readMediaSettings, writeMediaSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useMediaStore } from './media-store';
import { MediaSettingsPane, preferredAppItems } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getMediaSnapshot: vi.fn<() => Promise<MediaSnapshot>>(),
  mediaRefresh: vi.fn<() => Promise<IpcResult<null>>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getMediaSnapshot: ipc.getMediaSnapshot,
    mediaRefresh: ipc.mediaRefresh,
  },
  events: {
    mediaStateChanged: { listen: ipc.listen },
    mediaArtChanged: { listen: ipc.listen },
  },
}));

const session = (sourceAppId: string): MediaSession => ({
  sourceAppId,
  title: 'Track',
  artist: 'Artist',
  album: null,
  status: 'playing',
  positionMs: null,
  durationMs: null,
  shuffle: null,
  repeat: null,
  controls: {
    play: true,
    pause: true,
    next: false,
    previous: false,
    seek: false,
    shuffle: false,
    repeat: false,
  },
  isCurrent: true,
  artVersion: 0,
});

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('MediaSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useMediaStore.setState({ state: null, art: null, receivedAt: 0 });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getMediaSnapshot.mockReset().mockResolvedValue({
      state: {
        active: session('Spotify.exe'),
        sessions: [session('Spotify.exe'), session('MSEdge')],
        pinned: null,
        artKey: null,
      },
      art: null,
    });
    ipc.mediaRefresh.mockReset().mockResolvedValue({ status: 'ok', data: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderPane = () => {
    // Reads the cache reactively, as the settings window does, so a saved change re-renders.
    const Host = () => {
      const settings = useSettings() ?? defaultSettings();
      return (
        <SettingsEditorProvider settings={settings}>
          <MediaSettingsPane />
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

  const saved = () => readMediaSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('lists Automatic, the apps with sessions and the saved app even when closed', () => {
    expect(preferredAppItems(['Spotify.exe', 'MSEdge'], null, 'Automatic')).toEqual([
      { id: 'auto', label: 'Automatic' },
      { id: 'MSEdge', label: 'Microsoft Edge' },
      { id: 'Spotify.exe', label: 'Spotify' },
    ]);
    expect(preferredAppItems([], 'Spotify.exe', 'Automatic').map((item) => item.id)).toEqual([
      'auto',
      'Spotify.exe',
    ]);
  });

  it('writes the preferred app into the media namespace and clears it with Automatic', async () => {
    renderPane();
    await flush();
    const control = screen.getByRole('radiogroup', { name: 'Preferred app' });
    fireEvent.click(within(control).getByRole('radio', { name: 'Spotify' }));
    await flush();
    expect(saved().preferredApp).toBe('Spotify.exe');

    fireEvent.click(within(control).getByRole('radio', { name: 'Automatic' }));
    await flush();
    expect(saved().preferredApp).toBeNull();
  });

  it('toggles adaptive colours and the visualiser without touching other settings', async () => {
    cacheSettings(
      queryClient,
      writeMediaSettings(defaultSettings(), {
        preferredApp: 'MSEdge',
        adaptiveColours: true,
        visualiser: 'bars',
      }),
    );
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Adaptive colours' }));
    await flush();
    expect(saved()).toEqual({ preferredApp: 'MSEdge', adaptiveColours: false, visualiser: 'bars' });

    const visualiser = screen.getByRole('radiogroup', { name: 'Visualiser' });
    fireEvent.click(within(visualiser).getByRole('radio', { name: 'Off' }));
    await flush();
    expect(saved()).toEqual({ preferredApp: 'MSEdge', adaptiveColours: false, visualiser: 'off' });
    expect(ipc.updateSettings.mock.lastCall?.[0].general).toEqual(defaultSettings().general);
  });

  it('asks Rust to re-enumerate sessions', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(ipc.mediaRefresh).toHaveBeenCalledTimes(1);
  });
});
