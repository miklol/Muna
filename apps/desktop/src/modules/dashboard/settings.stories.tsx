import type { Settings } from '@muna/contracts';
import { defaultDashboardSettings, writeDashboardSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { DashboardSettingsPane } from './settings';

const meta = {
  title: 'Modules/Dashboard/Settings pane',
  component: DashboardSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="dashboard.title">
      <DashboardSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof DashboardSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default grid: seven widgets over eight cells, and the reset action. */
export const Default: Story = {};

/** A trimmed grid: three widgets; *Reset* brings the seven back. */
export const Trimmed: Story = {
  parameters: {
    settings: (base): Settings =>
      writeDashboardSettings(base, {
        ...defaultDashboardSettings(),
        slots: [
          { moduleId: 'media', span: 2 },
          { moduleId: 'pomodoro', span: 1 },
          { moduleId: 'todo', span: 1 },
        ],
      }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('3 widgets')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Reset' }));
    await expect(await canvas.findByText('7 widgets')).toBeVisible();
  },
};

/** The mirrored-English pseudo-locale on the value and action rows. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
