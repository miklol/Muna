import type { HealthCommand } from '@muna/contracts';
import { writeHealthSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { useHealthStore } from './health-store';
import { sampleSnapshot } from './sample-snapshot';
import { HealthSettingsPane } from './settings';

/** A fake health tracker for the pane: the data actions answer with a cleared day. */
const healthService: IpcHandlers = {
  get_health_snapshot: () => sampleSnapshot(),
  health_command: (args) => {
    const { command } = args as { command: HealthCommand };
    const base = sampleSnapshot();
    return command.kind === 'reset' || command.kind === 'clearHistory'
      ? sampleSnapshot({ today: { ...base.today, breaks: 0, water: 0, mindfulSeconds: 0 } })
      : base;
  },
};

const meta = {
  title: 'Modules/Health/Settings pane',
  component: HealthSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: healthService,
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="health.title">
      <HealthSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useHealthStore.setState({ snapshot: null, receivedAt: 0 });
  },
} satisfies Meta<typeof HealthSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Tracking on, a reminder every 50 minutes, eight glasses, box breathing, no wind-down. */
export const Default: Story = {};

/** An evening person: wind-down from 10 pm, the relax pattern, no headphones warning. */
export const Evening: Story = {
  parameters: {
    settings: (base) =>
      writeHealthSettings(base, {
        enabled: true,
        breakEveryMin: 45,
        waterGoal: 10,
        windDownHour: 22,
        hearingWarning: false,
        breathePattern: 'relax',
      }),
  } satisfies MunaStoryParameters,
};

/** Tracking off: the rows stay editable so the goals are ready when it comes back on. */
export const Off: Story = {
  parameters: {
    settings: (base) =>
      writeHealthSettings(base, {
        enabled: false,
        breakEveryMin: 50,
        waterGoal: 8,
        windDownHour: null,
        hearingWarning: true,
        breathePattern: 'box',
      }),
  } satisfies MunaStoryParameters,
};

/** *Clear history* asks first. */
export const ClearConfirm: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Clear history' }));
    await expect(canvas.getByText('Clear the whole history?')).toBeVisible();
  },
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
