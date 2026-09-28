import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { refuse } from '../../storybook/ipc';
import { monitors } from '../../storybook/samples';
import { ScreensPane } from './screens';

const meta = {
  title: 'Settings/Multiple screens pane',
  component: ScreensPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: {
      list_monitors: () => monitors,
    },
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.screens">
      <ScreensPane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof ScreensPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two displays, the primary marked, both following the defaults. */
export const Default: Story = {};

/** The second display has its own layout: an island, and the defaults switch is off. */
export const OwnLayout: Story = {
  parameters: {
    settings: (base) => ({
      ...base,
      shell: {
        ...base.shell,
        monitors: {
          [monitors[1]?.id ?? 'DISPLAY2']: { ...base.shell.defaults, shape: 'island', offsetY: 6 },
        },
      },
    }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The pane lists displays after `list_monitors` answers, so wait for the cards.
    const switches = await canvas.findAllByRole('switch', { name: 'Use the defaults' });
    await expect(switches[0]).toBeChecked();
    await expect(switches[1]).not.toBeChecked();
  },
};

/** Switching a display off the defaults reveals its own shape, placement and offsets. */
export const Overrides: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [primary] = await canvas.findAllByRole('switch', { name: 'Use the defaults' });
    if (primary === undefined) throw new Error('expected a defaults switch');
    await userEvent.click(primary);
    await expect(primary).not.toBeChecked();
    await expect(canvas.getAllByRole('radio', { name: 'Island' })).toHaveLength(1);
  },
};

/** A single display: one card, nothing to compare against. */
export const OneDisplay: Story = {
  parameters: {
    ipc: {
      list_monitors: () => monitors.slice(0, 1),
    },
  } satisfies MunaStoryParameters,
};

/** Windows returned no displays at all, which happens over Remote Desktop. */
export const NoDisplays: Story = {
  parameters: {
    ipc: {
      list_monitors: () => [],
    },
  } satisfies MunaStoryParameters,
};

/** The display list failed: the pane offers a retry instead of an empty page. */
export const Failed: Story = {
  parameters: {
    ipc: {
      list_monitors: () => refuse('platform.monitors', 'Display enumeration failed.'),
    },
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the cards, chips and segmented rows. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
