import type { Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readWindowSnapSettings, writeWindowSnapSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { WindowSnapSettingsPane, windowSnapDefaults } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: unknown };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { updateSettings: ipc.updateSettings, getSettings: ipc.getSettings },
  events: {},
}));

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('WindowSnapSettingsPane', () => {
  const queryClient = createQueryClient();

  beforeEach(() => {
    vi.useFakeTimers();
    queryClient.clear();
    cacheSettings(queryClient, defaultSettings());
    ipc.updateSettings
      .mockReset()
      .mockImplementation((settings) => Promise.resolve({ status: 'ok', data: settings }));
    ipc.getSettings
      .mockReset()
      .mockImplementation(() =>
        Promise.resolve(queryClient.getQueryData<Settings>(settingsQueryKey) ?? defaultSettings()),
      );
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
          <WindowSnapSettingsPane />
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
    readWindowSnapSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  it('shows a toggle per zone, all on by default, the count, and the grid off', async () => {
    renderPane();
    await flush();
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    const switches = screen.getAllByRole('switch');
    // Ten zones plus the grid toggle.
    expect(switches).toHaveLength(11);
    expect(screen.getByRole('switch', { name: 'Maximise' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Centre third' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Show a grid' })).not.toBeChecked();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('turns zones off and on, keeping the strip order, and blocks the eleventh tile', async () => {
    cacheSettings(
      queryClient,
      writeWindowSnapSettings(defaultSettings(), {
        ...windowSnapDefaults(),
        zones: ['leftHalf', 'rightHalf'],
        grid: { rows: 2, cols: 4, gap: 8 },
      }),
    );
    renderPane();
    await flush();
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    // Full: the zones that are off cannot come on, the ones that are on can go off.
    expect(screen.getByRole('switch', { name: 'Maximise' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Left half' })).toBeEnabled();

    fireEvent.click(screen.getByRole('switch', { name: 'Left half' }));
    await flush();
    expect(saved().zones).toEqual(['rightHalf']);
    expect(screen.getByText('9 of 10')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Maximise' })).toBeEnabled();

    fireEvent.click(screen.getByRole('switch', { name: 'Top left' }));
    await flush();
    expect(saved().zones).toEqual(['topLeft', 'rightHalf']);
  });

  it('keeps the last zone on while there is no grid', async () => {
    cacheSettings(
      queryClient,
      writeWindowSnapSettings(defaultSettings(), { ...windowSnapDefaults(), zones: ['maximize'] }),
    );
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Maximise' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Maximise' })).toBeDisabled();
    expect(screen.getByText('1 of 10')).toBeInTheDocument();
  });

  it('switching the grid on starts at 2 × 2, trims the zones to fit, and shows its controls', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show a grid' }));
    await flush();
    expect(saved().grid).toEqual({ rows: 2, cols: 2, gap: 8 });
    // Ten zones and four cells do not fit: the last zones make way, ten tiles in all.
    expect(saved().zones).toHaveLength(6);
    expect(screen.getByText('10 of 10')).toBeInTheDocument();
    // Rows and columns each offer 1–4, both at 2.
    const twos = screen.getAllByRole('radio', { name: '2' });
    expect(twos).toHaveLength(2);
    for (const radio of twos) {
      expect(radio).toBeChecked();
    }
    expect(screen.getByRole('slider', { name: 'Gap' })).toHaveValue('8');

    fireEvent.click(screen.getAllByRole('radio', { name: '3' })[0]!);
    await flush();
    expect(saved().grid).toEqual({ rows: 3, cols: 2, gap: 8 });
    expect(saved().zones).toHaveLength(4);

    fireEvent.click(screen.getByRole('switch', { name: 'Show a grid' }));
    await flush();
    expect(saved().grid).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
  });
});
