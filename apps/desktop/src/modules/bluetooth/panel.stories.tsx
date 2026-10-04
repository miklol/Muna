import type { BluetoothCommand, BluetoothSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { refuse } from '../../storybook/ipc';
import { bluetoothDevices, bluetoothSnapshot } from '../../storybook/samples';
import { useBluetoothStore } from './bluetooth-store';
import { BluetoothPanel } from './panel';

/**
 * A fake Bluetooth service: connect and disconnect flip the device the way Windows would, the
 * radio switch flips every device off with it, and a device that always refuses shows how the
 * panel words a refusal beside the row.
 */
const bluetoothService = (initial: BluetoothSnapshot, refusing?: string): IpcHandlers => ({
  get_bluetooth_snapshot: () => initial,
  bluetooth_command: (args) => {
    const { command } = args as { command: BluetoothCommand };
    if (command.kind === 'setRadio') {
      return bluetoothSnapshot({
        ...initial,
        radio: command.on ? 'on' : 'off',
        devices: initial.devices.map((device) => ({
          ...device,
          connected: command.on && device.connected,
        })),
      });
    }
    if (command.id === refusing) {
      return refuse('platform.os', 'The device did not answer.');
    }
    return bluetoothSnapshot({
      ...initial,
      devices: initial.devices.map((device) =>
        device.id === command.id ? { ...device, connected: command.kind === 'connect' } : device,
      ),
    });
  },
});

const meta = {
  title: 'Modules/Bluetooth/Panel',
  component: BluetoothPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: bluetoothService(bluetoothSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Bluetooth">
      <BluetoothPanel />
    </PanelFrame>
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
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof BluetoothPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two devices connected with their battery, one paired but away; the hidden phone is left out. */
export const Default: Story = {};

/** Connecting the keyboard: the row says so until Windows answers, then it reads connected. */
export const Connects: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect' }));
    await waitFor(async () => {
      await expect(canvas.getByText('Connected')).toBeVisible();
    });
  },
};

/** The device refuses: the row keeps the reason where the status was. */
export const Refused: Story = {
  parameters: {
    ipc: bluetoothService(bluetoothSnapshot(), bluetoothDevices.keyboard.id),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Connect' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toBeVisible();
    });
  },
};

/** The radio is off: the switch is the only control and every device is greyed. */
export const RadioOff: Story = {
  parameters: {
    ipc: bluetoothService(
      bluetoothSnapshot({
        radio: 'off',
        devices: Object.values(bluetoothDevices).map((device) => ({
          ...device,
          connected: false,
        })),
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** Nothing paired yet: the empty state points at Windows settings. */
export const NothingPaired: Story = {
  parameters: {
    ipc: bluetoothService(bluetoothSnapshot({ devices: [] })),
  } satisfies MunaStoryParameters,
};

/** A machine without a Bluetooth radio, or a build that cannot enumerate devices. */
export const Unavailable: Story = {
  parameters: {
    ipc: bluetoothService(
      bluetoothSnapshot({ radio: 'unavailable', available: false, devices: [] }),
    ),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: rows, battery and the radio switch flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
