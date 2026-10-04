import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { refuse } from '../../storybook/ipc';
import { AboutPane } from './about';

const meta = {
  title: 'Settings/About and diagnostics pane',
  component: AboutPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: {
      export_settings: () => 'C:\\Users\\Ada\\Documents\\muna-settings.json',
      import_settings: () => null,
      open_logs_folder: () => null,
    },
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.about">
      <AboutPane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof AboutPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Version, platform and profile folder, then diagnostics, backup and the reset row. */
export const Default: Story = {};

/** Export reports where the file went, in a live status line. */
export const Exports: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Export settings' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/muna-settings\.json/);
    });
  },
};

/** The export dialog failed: the status line says so in plain words. */
export const ExportFailed: Story = {
  parameters: {
    ipc: {
      export_settings: () => refuse('settings.dialog', 'The dialog could not open.'),
      import_settings: () => null,
      open_logs_folder: () => null,
    },
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Export settings' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/did not work/);
    });
  },
};

/** Reset asks first: the confirm row replaces the action until Cancel or Reset is chosen. */
export const ConfirmsReset: Story = {
  parameters: {
    settings: (base) => ({ ...base, general: { ...base.general, accent: 'purple' } }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Reset all settings' }));
    await expect(canvas.getByText('Reset every setting to its default?')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
    await expect(canvas.getByRole('button', { name: 'Reset all settings' })).toBeVisible();
  },
};

/** The mirrored-English pseudo-locale on value rows, the path and the action buttons. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
