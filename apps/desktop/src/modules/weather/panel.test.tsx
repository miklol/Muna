import type { Forecast, IpcError, Place, WeatherCommand, WeatherSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { HOURS_SHOWN, WeatherPanel, placeLabel } from './panel';
import { useWeatherStore } from './weather-store';

type Listener<T> = (event: { payload: T }) => void;
type IpcResult<T> = { status: 'ok'; data: T } | { status: 'error'; error: IpcError };

const ipc = vi.hoisted(() => {
  const listeners: Listener<{ snapshot: WeatherSnapshot }>[] = [];
  return {
    getWeatherSnapshot: vi.fn<() => Promise<WeatherSnapshot>>(),
    weatherCommand: vi.fn<(command: WeatherCommand) => Promise<WeatherSnapshot>>(),
    weatherSearch: vi.fn<(query: string) => Promise<IpcResult<Place[]>>>(),
    openSettings: vi.fn<() => Promise<void>>(),
    listen: vi.fn((callback: Listener<{ snapshot: WeatherSnapshot }>) => {
      listeners.push(callback);
      return Promise.resolve(() => {
        listeners.splice(listeners.indexOf(callback), 1);
      });
    }),
    emit: (snapshot: WeatherSnapshot) => {
      for (const listener of [...listeners]) listener({ payload: { snapshot } });
    },
    listenerCount: () => listeners.length,
  };
});

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: {
    getWeatherSnapshot: ipc.getWeatherSnapshot,
    weatherCommand: ipc.weatherCommand,
    weatherSearch: ipc.weatherSearch,
    openSettings: ipc.openSettings,
  },
  events: {
    weatherChanged: { listen: ipc.listen },
  },
}));

const paris: Place = {
  name: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  latitude: 48.85,
  longitude: 2.35,
};

const hour = (index: number): Forecast['hourly'][number] => ({
  time: `2026-09-26T${String(14 + index).padStart(2, '0')}:00`,
  condition: index % 2 === 0 ? 'partlyCloudy' : 'showers',
  isDay: 14 + index < 20,
  temperatureC: 18 - index,
  precipitationPercent: index === 1 ? 60 : index === 2 ? 5 : null,
});

const forecast = (): Forecast => ({
  timezone: 'Europe/Paris',
  current: {
    time: '2026-09-26T14:10',
    condition: 'partlyCloudy',
    isDay: true,
    temperatureC: 17.6,
    apparentTemperatureC: 16.2,
    humidityPercent: 55,
    windKmh: 12.4,
    pressureHpa: 1013.2,
    uvIndex: 3.4,
  },
  hourly: Array.from({ length: 9 }, (_, index) => hour(index)),
  daily: [
    {
      date: '2026-09-26',
      condition: 'partlyCloudy',
      highC: 21.4,
      lowC: 11.6,
      sunrise: '2026-09-26T07:38',
      sunset: '2026-09-26T19:42',
      precipitationPercent: 20,
    },
    {
      date: '2026-09-27',
      condition: 'rain',
      highC: 18,
      lowC: 10,
      sunrise: '2026-09-27T07:39',
      sunset: '2026-09-27T19:40',
      precipitationPercent: 80,
    },
  ],
});

const snapshot = (overrides: Partial<WeatherSnapshot> = {}): WeatherSnapshot => ({
  enabled: true,
  units: 'metric',
  location: { kind: 'manual', place: paris },
  forecast: forecast(),
  fetchedAtMs: new Date(2026, 8, 26, 14, 10).getTime(),
  fetching: false,
  error: null,
  ...overrides,
});

const renderPanel = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <WeatherPanel />
    </I18nextProvider>,
  );

const flush = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });

describe('placeLabel', () => {
  const t = i18n.t.bind(i18n);

  it('names the chosen city, or says the device location is in use', () => {
    expect(placeLabel({ kind: 'manual', place: paris }, t)).toBe('Paris');
    expect(placeLabel({ kind: 'auto', status: 'ready' }, t)).toBe('Current location');
  });
});

describe('WeatherPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWeatherStore.setState({ snapshot: null });
    ipc.getWeatherSnapshot.mockReset().mockResolvedValue(snapshot());
    ipc.weatherCommand.mockReset();
    ipc.openSettings.mockReset().mockResolvedValue(undefined);
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

  it('subscribes on mount, shows the forecast in the chosen units, and unlistens on unmount', async () => {
    const view = renderPanel();
    await flush();
    expect(ipc.getWeatherSnapshot).toHaveBeenCalledTimes(1);
    expect(ipc.listenerCount()).toBe(1);

    expect(document.querySelector('.weather-now__temp')).toHaveTextContent('18°');
    expect(screen.getByText('Partly cloudy')).toBeInTheDocument();
    expect(screen.getByText('H 21° · L 12°')).toBeInTheDocument();
    expect(screen.getByText('Feels like 16°')).toBeInTheDocument();
    expect(screen.getByText('Paris')).toBeInTheDocument();

    const chips = screen.getByRole('list', { name: 'Today' });
    expect(chips).toHaveTextContent('Humidity55%');
    expect(chips).toHaveTextContent('Wind12 km/h');
    expect(chips).toHaveTextContent('UV3');
    expect(chips).toHaveTextContent('Pressure1,013 hPa');
    expect(chips).toHaveTextContent('Sunrise7:38 AM');
    expect(chips).toHaveTextContent('Sunset7:42 PM');

    const hourly = screen.getByRole('list', { name: 'Next hours' });
    const cells = within(hourly).getAllByRole('listitem');
    expect(cells).toHaveLength(9);
    expect(cells[0]).toHaveTextContent('Now');
    expect(cells[0]).toHaveTextContent('18°');
    expect(cells[1]).toHaveTextContent('3 PM');
    expect(cells[1]).toHaveTextContent('60%');
    // The sentence is for screen readers; the visible cell shows the bare figure.
    expect(within(cells[1]!).getByText('60% chance of rain')).toHaveClass('sr-only');
    // Chances under 10 % are left blank so the strip does not fill with noise.
    expect(cells[2]).not.toHaveTextContent('5%');

    const daily = screen.getByRole('list', { name: 'Next days' });
    const days = within(daily).getAllByRole('listitem');
    expect(days).toHaveLength(2);
    expect(days[0]).toHaveTextContent('Today');
    expect(days[0]).toHaveTextContent('21°');
    expect(days[0]).toHaveTextContent('12°');
    expect(days[1]).toHaveTextContent('Sun');

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    expect(screen.queryByText(/^Updated/)).not.toBeInTheDocument();
    expect(document.querySelector('.weather-panel')?.getAttribute('data-sky')).toBe('cloudy-day');

    view.unmount();
    await flush();
    expect(ipc.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows at most twelve hours and converts to °F and mph when asked', async () => {
    const wide = forecast();
    wide.hourly = Array.from({ length: 24 }, (_, index) => ({
      ...hour(0),
      time: `2026-09-27T${String(index).padStart(2, '0')}:00`,
    }));
    ipc.getWeatherSnapshot.mockResolvedValue(snapshot({ units: 'imperial', forecast: wide }));
    renderPanel();
    await flush();
    const hourly = screen.getByRole('list', { name: 'Next hours' });
    expect(within(hourly).getAllByRole('listitem')).toHaveLength(HOURS_SHOWN);
    expect(document.querySelector('.weather-now__temp')).toHaveTextContent('64°');
    expect(screen.getByRole('list', { name: 'Today' })).toHaveTextContent('Wind8 mph');
  });

  it('keeps the last forecast with a timestamp chip when the refresh failed offline', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(snapshot({ error: 'offline' }));
    renderPanel();
    await flush();
    expect(document.querySelector('.weather-now__temp')).toHaveTextContent('18°');
    expect(screen.getByText('Updated 2:10 PM')).toBeInTheDocument();
  });

  it('sends a refresh and follows the snapshot the command returns', async () => {
    ipc.weatherCommand.mockResolvedValue(snapshot({ fetching: true }));
    renderPanel();
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await flush();
    expect(ipc.weatherCommand).toHaveBeenCalledWith({ kind: 'refresh' });
    expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
    act(() => {
      ipc.emit(snapshot({ fetching: false }));
    });
    await flush();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  });

  it('invites the user to turn the module on, and opens settings from there', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(
      snapshot({
        enabled: false,
        forecast: null,
        fetchedAtMs: null,
        location: { kind: 'auto', status: 'resolving' },
      }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('Weather is off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(ipc.openSettings).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.weather-panel')?.hasAttribute('data-sky')).toBe(false);
  });

  it('shows "Choose a city" once Windows denies the location, with a way to ask again', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(
      snapshot({ forecast: null, fetchedAtMs: null, location: { kind: 'auto', status: 'denied' } }),
    );
    ipc.weatherCommand.mockResolvedValue(
      snapshot({
        forecast: null,
        fetchedAtMs: null,
        location: { kind: 'auto', status: 'resolving' },
      }),
    );
    renderPanel();
    await flush();
    expect(screen.getByRole('button', { name: 'Choose a city' })).toBeInTheDocument();
    expect(screen.getByText(/not sharing your location/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(ipc.weatherCommand).toHaveBeenCalledWith({ kind: 'retryLocation' });
    expect(screen.getByRole('status', { name: 'Finding your location' })).toBeInTheDocument();
  });

  it('says when the PC has no location source, without a retry', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(
      snapshot({
        forecast: null,
        fetchedAtMs: null,
        location: { kind: 'auto', status: 'unavailable' },
      }),
    );
    renderPanel();
    await flush();
    expect(screen.getByRole('button', { name: 'Choose a city' })).toBeInTheDocument();
    expect(screen.getByText(/no location source/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('shows the loading silhouette while the first forecast is on its way', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(
      snapshot({
        forecast: null,
        fetchedAtMs: null,
        fetching: true,
        location: { kind: 'auto', status: 'ready' },
      }),
    );
    renderPanel();
    await flush();
    expect(screen.getByRole('status', { name: 'Loading the forecast' })).toBeInTheDocument();
  });

  it('explains a failed first fetch and offers a retry', async () => {
    ipc.getWeatherSnapshot.mockResolvedValue(
      snapshot({
        forecast: null,
        fetchedAtMs: null,
        error: 'provider',
        location: { kind: 'auto', status: 'ready' },
      }),
    );
    ipc.weatherCommand.mockResolvedValue(
      snapshot({
        forecast: null,
        fetchedAtMs: null,
        fetching: true,
        location: { kind: 'auto', status: 'ready' },
      }),
    );
    renderPanel();
    await flush();
    expect(screen.getByText('The weather service is having trouble')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(ipc.weatherCommand).toHaveBeenCalledWith({ kind: 'refresh' });
    expect(screen.getByRole('status', { name: 'Loading the forecast' })).toBeInTheDocument();
  });
});
