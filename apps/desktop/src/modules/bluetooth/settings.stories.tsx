import { defaultBluetoothSettings, writeBluetoothSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { bluetoothDevices, bluetoothSnapshot } from '../../storybook/samples';
import { useBluetoothStore } from './bluetooth-store';
import { BluetoothSettingsPane } from './settings';

const meta = {
  title: 'Modules/Bluetooth/Settings pane',
  component: BluetoothSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: { get_bluetooth_snapshot: () => bluetoothSnapshot() },
    settings: (base) =>
      writeBluetoothSettings(base, {
        ...defaultBluetoothSettings(),
        hiddenDevices: [bluetoothDevices.phone.id],
      }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="bluetooth.title">
      <BluetoothSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useBluetoothStore.setState({
      snapshot: null,
      pending: {},
      radioPending: false,
      errors: {},
      radioError: null,
    });
  },
} satisfies Meta<typeof BluetoothSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Low-battery notices on; four paired devices, the phone hidden from the panel. */
export const Default: Story = {};

/** Hiding the mouse saves at once: the switch turns off and stays off. */
export const HidesADevice: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mouse = await canvas.findByRole('switch', { name: bluetoothDevices.mouse.name });
    await userEvent.click(mouse);
    await expect(mouse).not.toBeChecked();
  },
};

/** Nothing paired: the devices section says where pairing happens. */
export const NothingPaired: Story = {
  parameters: {
    ipc: { get_bluetooth_snapshot: () => bluetoothSnapshot({ devices: [] }) },
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the sections, rows and switches. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
