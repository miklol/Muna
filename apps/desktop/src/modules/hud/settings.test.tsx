import type { HudState, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readHudSettings, writeHudSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { useHudStore } from './hud-store';
import { flyoutStatusKey, HudSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  getHudSnapshot: vi.fn<() => Promise<HudState>>(),
  hudSetMuted: vi.fn<(muted: boolean) => Promise<IpcResult<null>>>(),
  hudSetMicMuted: vi.fn<(muted: boolean) => Promise<IpcResult<null>>>(),
  hudSetBrightness: vi.fn<(monitorId: string, percent: number) => Promise<IpcResult<null>>>(),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    getHudSnapshot: ipc.getHudSnapshot,
    hudSetMuted: ipc.hudSetMuted,
    hudSetMicMuted: ipc.hudSetMicMuted,
    hudSetBrightness: ipc.hudSetBrightness,
  },
  events: {
    hudStateChanged: { listen: ipc.listen },
  },
}));

const snapshot: HudState = {
  volume: { percent: 40, muted: false },
  micMuted: true,
  monitors: [
    { id: '\\\\.\\DISPLAY1#0', name: 'DELL U2723QE', percent: 55, kind: 'external' },
    { id: 'panel', name: 'Built-in display', percent: 80, kind: 'internal' },
  ],
  osd: 'suppressed',
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(10);
  });

describe('HudSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    useHudStore.setState({ state: null });
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
    ipc.getHudSnapshot.mockReset().mockResolvedValue(snapshot);
    ipc.hudSetMuted.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.hudSetMicMuted.mockReset().mockResolvedValue({ status: 'ok', data: null });
    ipc.hudSetBrightness.mockReset().mockResolvedValue({ status: 'ok', data: null });
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
          <HudSettingsPane />
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

  const saved = () => readHudSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('names the flyout state, treating an unknown state as not found yet', () => {
    expect(flyoutStatusKey('suppressed')).toBe('hud.settings.flyoutSuppressed');
    expect(flyoutStatusKey('native')).toBe('hud.settings.flyoutNative');
    expect(flyoutStatusKey('unavailable')).toBe('hud.settings.flyoutUnavailable');
    expect(flyoutStatusKey(undefined)).toBe('hud.settings.flyoutUnavailable');
  });

  it('writes the preferences into the hud namespace without touching other settings', async () => {
    cacheSettings(
      queryClient,
      writeHudSettings(defaultSettings(), {
        replaceSystemFlyout: true,
        scrollOnStrip: 'panel',
        showLevelText: false,
      }),
    );
    renderPane();
    await flush();

    fireEvent.click(screen.getByRole('switch', { name: 'Replace system flyout' }));
    await flush();
    expect(saved()).toEqual({
      replaceSystemFlyout: false,
      scrollOnStrip: 'panel',
      showLevelText: false,
    });

    const scroll = screen.getByRole('radiogroup', { name: 'Scroll on strip' });
    fireEvent.click(within(scroll).getByRole('radio', { name: 'Change volume' }));
    await flush();
    expect(saved().scrollOnStrip).toBe('volume');

    fireEvent.click(screen.getByRole('switch', { name: 'Show level text' }));
    await flush();
    expect(saved()).toEqual({
      replaceSystemFlyout: false,
      scrollOnStrip: 'volume',
      showLevelText: true,
    });
    expect(ipc.updateSettings.mock.lastCall?.[0].general).toEqual(defaultSettings().general);
  });

  it('shows the tracker state and sends level changes straight to the HUD commands', async () => {
    renderPane();
    await flush();
    expect(ipc.getHudSnapshot).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Hidden while Muna runs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: 'Mute' }));
    expect(ipc.hudSetMuted).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('switch', { name: 'Mute microphone' }));
    expect(ipc.hudSetMicMuted).toHaveBeenCalledWith(false);

    // One slider per adjustable monitor, written on release only (DDC/CI is slow).
    const dell = screen.getByRole('slider', { name: 'DELL U2723QE' });
    expect(dell).toHaveValue('55');
    fireEvent.keyDown(dell, { key: 'ArrowRight' });
    fireEvent.keyUp(dell, { key: 'ArrowRight' });
    expect(ipc.hudSetBrightness).toHaveBeenCalledWith('\\\\.\\DISPLAY1#0', 56);
    expect(screen.getByRole('slider', { name: 'Built-in display' })).toHaveValue('80');
    // Preferences stayed untouched: levels are not settings.
    expect(ipc.updateSettings).not.toHaveBeenCalled();
  });

  it('says what to do when nothing can be adjusted', async () => {
    ipc.getHudSnapshot.mockResolvedValue({
      volume: null,
      micMuted: null,
      monitors: [],
      osd: 'unavailable',
    });
    renderPane();
    await flush();
    expect(screen.getByText('No adjustable display was found.')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Mute' })).not.toBeInTheDocument();
    expect(
      screen.getByText('Not found yet. It appears after the first volume key press.'),
    ).toBeInTheDocument();
  });
});
