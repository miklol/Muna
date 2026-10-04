import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { LayoutPane, PositionPane } from './layout';

const meta = {
  title: 'Settings/Layout pane',
  component: LayoutPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.layout">
      <LayoutPane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof LayoutPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The defaults: a notch, overlay placement, the 32 px strip. */
export const Default: Story = {};

/** An island with the reserved band and the comfortable strip. */
export const IslandReserved: Story = {
  parameters: {
    settings: (base) => ({
      ...base,
      shell: {
        ...base.shell,
        defaults: {
          ...base.shell.defaults,
          shape: 'island',
          mode: 'reserved',
          stripHeight: 'comfortable',
        },
      },
    }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Island' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Reserved' })).toBeChecked();
  },
};

/** Choosing a shape writes `shell.defaults.shape` and the segment stays chosen. */
export const ChoosesIsland: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Island' }));
    await expect(canvas.getByRole('radio', { name: 'Island' })).toBeChecked();
  },
};

/** Notch position: both offsets at zero, so Reset offsets has nothing to do. */
export const Position: Story = {
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.position">
      <PositionPane {...args} />
    </SettingsPaneFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Reset offsets' })).toBeDisabled();
  },
};

/** Notch position with the notch nudged: Reset offsets puts it back in the centre. */
export const PositionNudged: Story = {
  parameters: {
    settings: (base) => ({
      ...base,
      shell: { ...base.shell, defaults: { ...base.shell.defaults, offsetX: 120, offsetY: 8 } },
    }),
  } satisfies MunaStoryParameters,
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.position">
      <PositionPane {...args} />
    </SettingsPaneFrame>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const reset = canvas.getByRole('button', { name: 'Reset offsets' });
    await expect(reset).toBeEnabled();
    await userEvent.click(reset);
    await expect(reset).toBeDisabled();
  },
};

/** The mirrored-English pseudo-locale on the segmented rows: segments read right to left. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

/** Notch position in the pseudo-locale: the offset sliders and the reset row mirrored. */
export const PositionPseudoRtl: Story = {
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.position">
      <PositionPane {...args} />
    </SettingsPaneFrame>
  ),
  globals: { locale: 'ar-XB' },
};
