import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { GeneralPane } from './general';

const meta = {
  title: 'Settings/General pane',
  component: GeneralPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
    onShowTour: () => undefined,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.general">
      <GeneralPane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof GeneralPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh profile: Windows chooses the language, nothing else is switched on. */
export const Default: Story = {};

/** German chosen: the tile is selected and the document is saved with `general.language`. */
export const GermanChosen: Story = {
  parameters: {
    settings: (base) => ({ ...base, general: { ...base.general, language: 'de' } }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Deutsch' })).toBeChecked();
  },
};

/** Picking a tile switches the window at once: the pane re-reads its own catalog. */
export const SwitchesLive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Français' }));
    await expect(canvas.getByRole('radio', { name: 'Français' })).toBeChecked();
    await expect(document.documentElement).toHaveAttribute('lang', 'fr');
    await userEvent.click(canvas.getByRole('radio', { name: 'Windows' }));
    await expect(document.documentElement).toHaveAttribute('lang', 'en');
  },
};

/** Spike S3: the mirrored-English pseudo-locale on the tiles, switches and section headers. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
