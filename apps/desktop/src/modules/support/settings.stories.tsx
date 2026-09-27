import type { SupportSnapshot } from '@muna/contracts';
import { writeSupportSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import { type IpcHandlers, type MunaStoryParameters, refuse } from '../../storybook/ipc';
import { sampleSnapshot } from './sample-snapshot';
import { SupportSettingsPane } from './settings';
import { useSupportStore } from './support-store';

/** A fake support service for the pane; the update check finds `next`, or nothing. */
const supportService = (snapshot: SupportSnapshot, next: string | null): IpcHandlers => ({
  get_support_snapshot: () => snapshot,
  support_open: () => null,
  support_command: (args) => {
    const { kind } = (args as { command: { kind: string } }).command;
    switch (kind) {
      case 'checkUpdates':
        return { kind: 'update', available: next !== null, version: next, notes: null };
      case 'diagnostics':
        return {
          kind: 'bundle',
          path: 'C:\\Users\\sam\\Desktop\\muna-diagnostics-20260927-1030.zip',
          entries: 5,
          atMs: Date.now(),
        };
      default:
        return { kind: 'done' };
    }
  },
});

const meta = {
  title: 'Modules/Support/Settings pane',
  component: SupportSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: supportService(sampleSnapshot(), null),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="support.title">
      <SupportSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useSupportStore.setState({ snapshot: null });
  },
} satisfies Meta<typeof SupportSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Stable channel, a current build, 1.2 MB of logs, the repairs. */
export const Default: Story = {};

/** On the beta channel, and a newer version is out. */
export const UpdateAvailable: Story = {
  parameters: {
    ipc: supportService(sampleSnapshot({ channel: 'beta' }), '0.4.0-beta.1'),
    settings: (base) => writeSupportSettings(base, { channel: 'beta', crashReports: false }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Check' }));
    await canvas.findByRole('button', { name: 'Get it' });
  },
};

/** Offline: the check fails and says so in the row. */
export const CheckFailed: Story = {
  parameters: {
    ipc: {
      ...supportService(sampleSnapshot(), null),
      support_command: () => refuse('support.updater', 'offline'),
    },
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Check' }));
    await expect(canvas.findByText(/Updates could not be checked/u)).resolves.toBeVisible();
  },
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};
