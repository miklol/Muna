import type { Settings } from '@muna/contracts';
import { defaultDayProgressSettings, writeDayProgressSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { DayProgressSettingsPane } from './settings';

const meta = {
  title: 'Modules/Day progress/Settings pane',
  component: DayProgressSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="dayProgress.title">
      <DayProgressSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof DayProgressSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default 09:00–18:00 day, no bedtime, tasks and focus sessions on, the strip bar off. */
export const Default: Story = {};

/** A bedtime set: the time picker row appears under the switch. */
export const WithBedtime: Story = {
  parameters: {
    settings: (base): Settings =>
      writeDayProgressSettings(base, {
        ...defaultDayProgressSettings(),
        bedtimeMinutes: 23 * 60,
        showDayInStrip: true,
      }),
  } satisfies MunaStoryParameters,
};

/** Turning the bedtime on from the switch saves a default hour and shows the picker. */
export const TurnsBedtimeOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bedtime = await canvas.findByRole('switch', { name: 'Show a bedtime marker' });
    await userEvent.click(bedtime);
    await expect(bedtime).toBeChecked();
  },
};

/** The mirrored-English pseudo-locale on the hour rows and switches. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
