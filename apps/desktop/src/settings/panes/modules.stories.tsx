import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { modules } from '../../modules/registry';
import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { ModulesPane } from './modules';

const meta = {
  title: 'Settings/Modules pane',
  component: ModulesPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
    modules,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.modules">
      <ModulesPane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof ModulesPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Every registered module, in registry order, all switched on. */
export const Default: Story = {};

/** Two modules hidden and Tasks moved to the top: the saved order and the switches agree. */
export const Rearranged: Story = {
  parameters: {
    settings: (base) => ({
      ...base,
      shell: {
        ...base.shell,
        moduleOrder: ['todo', 'media', 'pomodoro'],
        disabledModules: ['mirror', 'support'],
      },
    }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('switch', { name: 'Show Mirror' })).not.toBeChecked();
    await expect(canvas.getByRole('button', { name: 'Move Tasks up' })).toBeDisabled();
  },
};

/** The arrows reorder from the keyboard: moving Media down swaps it with the module below. */
export const MovesAModule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Move Media down' }));
    const labels = canvas.getAllByRole('switch').map((toggle) => toggle.getAttribute('aria-label'));
    await expect(labels.indexOf('Show Media')).toBe(2);
  },
};

/** Switching a module off hides it from the notch; the row stays so it can come back. */
export const HidesAModule: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const show = canvas.getByRole('switch', { name: 'Show Weather' });
    await userEvent.click(show);
    await expect(show).not.toBeChecked();
  },
};

/** No modules registered: the empty state says they arrive with updates. */
export const Empty: Story = {
  args: { modules: [] },
};

/** The mirrored-English pseudo-locale: arrows and switches sit at the row's start. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
