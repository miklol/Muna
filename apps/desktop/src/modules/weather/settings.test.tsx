import type { IpcError, Place, Settings } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { defaultSettings, readWeatherSettings, writeWeatherSettings } from '@muna/contracts';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { createQueryClient } from '../../lib/query-client';
import { cacheSettings, settingsQueryKey, useSettings } from '../../lib/settings';
import { SettingsEditorProvider } from '../../settings/settings-editor';
import { describePlace, describeRegion, WeatherSettingsPane } from './settings';

type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => ({
  updateSettings: vi.fn<(settings: Settings) => Promise<IpcResult<Settings>>>(),
  getSettings: vi.fn<() => Promise<Settings>>(),
  weatherSearch: vi.fn<(query: string) => Promise<IpcResult<Place[]>>>(),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    updateSettings: ipc.updateSettings,
    getSettings: ipc.getSettings,
    weatherSearch: ipc.weatherSearch,
  },
  events: {},
}));

const paris: Place = {
  name: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  latitude: 48.85,
  longitude: 2.35,
};
const parisTexas: Place = {
  name: 'Paris',
  region: 'Texas',
  country: 'United States',
  latitude: 33.66,
  longitude: -95.56,
};

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('describePlace', () => {
  it('joins the parts the geocoder knows and leaves out the ones it does not', () => {
    expect(describePlace(paris, 'en')).toBe('Paris, Île-de-France, France');
    expect(describePlace({ ...paris, region: null }, 'en')).toBe('Paris, France');
    expect(describeRegion(parisTexas, 'en')).toBe('Texas, United States');
    expect(describeRegion({ ...paris, region: null, country: null }, 'en')).toBeUndefined();
  });
});

describe('WeatherSettingsPane', () => {
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
    ipc.weatherSearch.mockReset();
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
          <WeatherSettingsPane />
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
    readWeatherSettings(ipc.updateSettings.mock.lastCall?.[0] ?? defaultSettings());

  const chooseCity = () => {
    const location = screen.getByRole('radiogroup', { name: 'Location' });
    fireEvent.click(within(location).getByRole('radio', { name: 'City' }));
  };

  it('starts off, on the device location, in metric, and leads with what leaves the PC', async () => {
    renderPane();
    await flush();
    expect(screen.getByRole('switch', { name: 'Show weather' })).not.toBeChecked();
    expect(screen.getByText(/Weather is off until you turn it on/)).toBeInTheDocument();
    const location = screen.getByRole('radiogroup', { name: 'Location' });
    expect(within(location).getByRole('radio', { name: 'Current location' })).toBeChecked();
    const units = screen.getByRole('radiogroup', { name: 'Units' });
    expect(within(units).getByRole('radio', { name: '°C, km/h' })).toBeChecked();
    expect(screen.queryByRole('textbox', { name: 'Search for a city' })).not.toBeInTheDocument();
  });

  it('saves the switch and the units at once', async () => {
    renderPane();
    await flush();
    fireEvent.click(screen.getByRole('switch', { name: 'Show weather' }));
    await flush();
    expect(saved().enabled).toBe(true);
    const units = screen.getByRole('radiogroup', { name: 'Units' });
    fireEvent.click(within(units).getByRole('radio', { name: '°F, mph' }));
    await flush();
    expect(saved().units).toBe('imperial');
    expect(saved().enabled).toBe(true);
  });

  it('reveals the city search without writing coordinates until a result is pressed', async () => {
    cacheSettings(
      queryClient,
      writeWeatherSettings(defaultSettings(), {
        ...readWeatherSettings(defaultSettings()),
        enabled: true,
      }),
    );
    ipc.weatherSearch.mockResolvedValue({ status: 'ok', data: [paris, parisTexas] });
    renderPane();
    await flush();
    chooseCity();
    await flush();
    expect(ipc.updateSettings).not.toHaveBeenCalled();
    expect(screen.getByText('None yet')).toBeInTheDocument();

    const field = screen.getByRole('textbox', { name: 'Search for a city' });
    fireEvent.change(field, { target: { value: 'Paris' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.weatherSearch).toHaveBeenCalledWith('Paris');
    const results = screen.getByRole('list', { name: 'Search for a city' });
    expect(within(results).getAllByRole('button')).toHaveLength(2);
    expect(within(results).getByText('Texas, United States')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Paris, Texas, United States' }));
    await flush();
    expect(saved().location).toEqual({ kind: 'manual', place: parisTexas });
    expect(screen.getByText('Paris, Texas, United States')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search for a city' })).not.toBeInTheDocument();
  });

  it('says why a search returned nothing', async () => {
    cacheSettings(
      queryClient,
      writeWeatherSettings(defaultSettings(), {
        ...readWeatherSettings(defaultSettings()),
        enabled: true,
      }),
    );
    ipc.weatherSearch.mockResolvedValueOnce({ status: 'ok', data: [] });
    renderPane();
    await flush();
    chooseCity();
    const field = screen.getByRole('textbox', { name: 'Search for a city' });
    fireEvent.change(field, { target: { value: 'Nowhere' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('No places match');

    ipc.weatherSearch.mockResolvedValueOnce({
      status: 'error',
      error: { code: 'weather.offline', message: 'offline' },
    });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(screen.getByRole('status')).toHaveTextContent('Search needs a connection.');
  });

  it('refuses to search while the module is off, and says so instead of asking the geocoder', async () => {
    renderPane();
    await flush();
    chooseCity();
    const field = screen.getByRole('textbox', { name: 'Search for a city' });
    fireEvent.change(field, { target: { value: 'Paris' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await flush();
    expect(ipc.weatherSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Turn on weather to search for a city.');
  });

  it('shows the saved city and goes back to the device location in one press', async () => {
    cacheSettings(
      queryClient,
      writeWeatherSettings(defaultSettings(), {
        enabled: true,
        units: 'metric',
        location: { kind: 'manual', place: paris },
      }),
    );
    renderPane();
    await flush();
    const location = screen.getByRole('radiogroup', { name: 'Location' });
    expect(within(location).getByRole('radio', { name: 'City' })).toBeChecked();
    expect(screen.getByText('Paris, Île-de-France, France')).toBeInTheDocument();

    fireEvent.click(within(location).getByRole('radio', { name: 'Current location' }));
    await flush();
    expect(saved().location).toEqual({ kind: 'auto' });
    expect(screen.queryByRole('textbox', { name: 'Search for a city' })).not.toBeInTheDocument();
  });
});
