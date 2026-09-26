import type { Forecast, Place, WeatherSnapshot } from '@muna/contracts';
import type * as Contracts from '@muna/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../../lib/i18n';
import { useWeatherStore } from './weather-store';
import { WeatherWidget } from './widget';

const ipc = vi.hoisted(() => ({
  getWeatherSnapshot: vi.fn(() => new Promise<never>(() => undefined)),
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

vi.mock('@muna/contracts', async (importOriginal) => ({
  ...(await importOriginal<typeof Contracts>()),
  commands: { getWeatherSnapshot: ipc.getWeatherSnapshot },
  events: { weatherChanged: { listen: ipc.listen } },
}));

const paris: Place = {
  name: 'Paris',
  region: 'Île-de-France',
  country: 'France',
  latitude: 48.85,
  longitude: 2.35,
};

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
  hourly: [],
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

const renderWidget = (span: 1 | 2) =>
  render(
    <I18nextProvider i18n={i18n}>
      <WeatherWidget span={span} />
    </I18nextProvider>,
  );

describe('WeatherWidget', () => {
  beforeEach(() => {
    useWeatherStore.setState({ snapshot: null });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows the temperature, the condition and the range; a wide card adds the place', () => {
    useWeatherStore.setState({ snapshot: snapshot() });
    const narrow = renderWidget(1);
    expect(screen.getByText('18°')).toBeInTheDocument();
    expect(screen.getByText('Partly cloudy')).toBeInTheDocument();
    expect(screen.getByText('H 21° · L 12°')).toBeInTheDocument();
    expect(screen.queryByText('Paris')).not.toBeInTheDocument();
    narrow.unmount();

    renderWidget(2);
    expect(screen.getByText('Paris')).toBeInTheDocument();
  });

  it('converts to imperial when the settings say so', () => {
    useWeatherStore.setState({ snapshot: snapshot({ units: 'imperial' }) });
    renderWidget(1);
    expect(screen.getByText('64°')).toBeInTheDocument();
  });

  it('says in one line when the module is off, needs a city, is locating, failed or is loading', () => {
    const cases: [Partial<WeatherSnapshot>, string][] = [
      [{ enabled: false }, 'Weather is off'],
      [{ forecast: null, location: { kind: 'auto', status: 'denied' } }, 'Choose a city'],
      [
        { forecast: null, location: { kind: 'auto', status: 'resolving' } },
        'Finding your location',
      ],
      [{ forecast: null, error: 'offline' }, 'You seem to be offline'],
      [{ forecast: null, fetching: true }, 'Loading the forecast'],
    ];
    for (const [overrides, text] of cases) {
      useWeatherStore.setState({ snapshot: snapshot(overrides) });
      const view = renderWidget(1);
      expect(screen.getByText(text)).toBeInTheDocument();
      view.unmount();
    }
  });
});
