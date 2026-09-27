import { writeMirrorSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { MirrorSettingsPane } from './settings';

const meta = {
  title: 'Modules/Mirror/Settings pane',
  component: MirrorSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="mirror.title">
      <MirrorSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof MirrorSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The defaults: the camera off with the privacy promise, mirrored, the system default camera. */
export const Default: Story = {};

/** The camera on and a desk camera chosen from the panel; *Use default* clears it. */
export const CameraChosen: Story = {
  parameters: {
    settings: (base) =>
      writeMirrorSettings(base, {
        enabled: true,
        flip: false,
        deviceId: 'story-desk',
        deviceLabel: 'Desk camera',
      }),
  } satisfies MunaStoryParameters,
};

/** Turning the camera on writes the document through the fake IPC like Rust would. */
export const TurningOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = await canvas.findByRole('switch', { name: 'Use the camera' });
    await userEvent.click(toggle);
    await expect(toggle).toBeChecked();
  },
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};
