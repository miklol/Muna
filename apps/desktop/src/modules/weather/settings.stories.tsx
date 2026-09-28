import type { Place } from '@muna/contracts';
import { defaultWeatherSettings, writeWeatherSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { paris } from '../../storybook/samples';
import { WeatherSettingsPane } from './settings';

const lyon: Place = {
  name: 'Lyon',
  region: 'Auvergne-Rhône-Alpes',
  country: 'France',
  latitude: 45.76,
  longitude: 4.84,
};
const lyonUS: Place = {
  name: 'Lyon',
  region: 'Mississippi',
  country: 'United States',
  latitude: 34.22,
  longitude: -90.55,
};

/** A fake geocoder: any query for "Lyon" finds two, anything else finds nothing. */
const geocoder: IpcHandlers = {
  weather_search: (args) => {
    const { query } = args as { query: string };
    return query.toLowerCase().startsWith('lyon') ? [lyon, lyonUS] : [];
  },
};

const meta = {
  title: 'Modules/Weather/Settings pane',
  component: WeatherSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: geocoder,
    settings: (base) =>
      writeWeatherSettings(base, {
        ...defaultWeatherSettings(),
        enabled: true,
        location: { kind: 'manual', place: paris },
      }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="weather.title">
      <WeatherSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof WeatherSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** On, Paris chosen by hand, metric. */
export const Default: Story = {};

/** Searching for a city: two matches, each saying its region so the right one is easy. */
export const SearchResults: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Search for a city' }),
      'Lyon{Enter}',
    );
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /^Use Lyon, Mississippi/ })).toBeVisible();
    });
  },
};

/** Choosing a match saves it as the city and the row reads it back. */
export const ChoosesACity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(
      await canvas.findByRole('textbox', { name: 'Search for a city' }),
      'Lyon{Enter}',
    );
    await userEvent.click(await canvas.findByRole('button', { name: /^Use Lyon, Auvergne/ }));
    await waitFor(async () => {
      await expect(
        canvas.getByText(/^Lyon, Auvergne/, { selector: '.muna-list-row__trailing' }),
      ).toBeVisible();
    });
  },
};

/** Fresh install: the module is off and nothing leaves the PC until the switch is on. */
export const Off: Story = {
  parameters: {
    settings: (base) => writeWeatherSettings(base, defaultWeatherSettings()),
  } satisfies MunaStoryParameters,
};

/** The device location in Fahrenheit. */
export const CurrentLocationImperial: Story = {
  parameters: {
    settings: (base) =>
      writeWeatherSettings(base, { ...defaultWeatherSettings(), enabled: true, units: 'imperial' }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the switch, segmented rows and the city search. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
