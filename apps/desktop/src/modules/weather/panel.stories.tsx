import type { WeatherSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { weatherForecast, weatherSnapshot } from '../../storybook/samples';
import { WeatherPanel } from './panel';
import { useWeatherStore } from './weather-store';

/** A fake forecast service: refresh answers with the same forecast, freshly stamped. */
const weatherService = (initial: WeatherSnapshot): IpcHandlers => ({
  get_weather_snapshot: () => initial,
  weather_command: () => ({ ...initial, fetchedAtMs: Date.now(), error: null }),
  open_settings: () => null,
});

const meta = {
  title: 'Modules/Weather/Panel',
  component: WeatherPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: weatherService(weatherSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Weather">
      <WeatherPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useWeatherStore.setState({ snapshot: null });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof WeatherPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A partly cloudy afternoon in Paris: the moment now, the day's chips, hours and days. */
export const Default: Story = {};

/** Night, in Fahrenheit, from the device location. */
export const NightImperial: Story = {
  parameters: {
    ipc: weatherService(
      weatherSnapshot({
        units: 'imperial',
        location: { kind: 'auto', status: 'ready' },
        forecast: {
          ...weatherForecast(),
          current: {
            ...weatherForecast().current,
            condition: 'clear',
            isDay: false,
            temperatureC: 9.2,
            apparentTemperatureC: 7.5,
          },
        },
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** Offline with a cached forecast: the chips stay, the timestamp says how old they are. */
export const OfflineCached: Story = {
  parameters: {
    ipc: weatherService(
      weatherSnapshot({ error: 'offline', fetchedAtMs: Date.now() - 3 * 60 * 60_000 }),
    ),
  } satisfies MunaStoryParameters,
};

/** Fetching the first forecast for a city: the loading state. */
export const Loading: Story = {
  parameters: {
    ipc: weatherService(weatherSnapshot({ forecast: null, fetchedAtMs: null, fetching: true })),
  } satisfies MunaStoryParameters,
};

/** Windows refused the location: choose a city, or try the device location again. */
export const LocationDenied: Story = {
  parameters: {
    ipc: weatherService(
      weatherSnapshot({
        location: { kind: 'auto', status: 'denied' },
        forecast: null,
        fetchedAtMs: null,
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** The module is off: the panel says where to turn it on. */
export const Off: Story = {
  parameters: {
    ipc: weatherService(weatherSnapshot({ enabled: false, forecast: null, fetchedAtMs: null })),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the hourly and daily strips scroll from the right. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
