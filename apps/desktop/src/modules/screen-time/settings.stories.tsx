import type { ScreenTimeCommand, ScreenTimeSnapshot } from '@muna/contracts';
import { defaultScreenTimeSettings, writeScreenTimeSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { emptySnapshot, sampleSnapshot } from './sample-snapshot';
import { useScreenTimeStore } from './screen-time-store';
import { ScreenTimeSettingsPane } from './settings';

/** A fake service for the pane: including an app removes it from the list, exports succeed. */
const screenTimeService = (initial: ScreenTimeSnapshot): IpcHandlers => ({
  get_screen_time_snapshot: () => initial,
  screen_time_watch: () => null,
  screen_time_command: (args) => {
    const { command } = args as { command: ScreenTimeCommand };
    if (command.kind === 'include') {
      return { ...initial, excluded: initial.excluded.filter((app) => app.exe !== command.exe) };
    }
    if (command.kind === 'clearHistory') return emptySnapshot({ excluded: initial.excluded });
    return initial;
  },
  screen_time_export: () => 'C:\\Users\\sam\\Documents\\muna-screen-time-2026-09-29.csv',
});

const meta = {
  title: 'Modules/Screen time/Settings pane',
  component: ScreenTimeSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: screenTimeService(sampleSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="screenTime.title">
      <ScreenTimeSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useScreenTimeStore.setState({ snapshot: null, receivedAt: 0 });
  },
} satisfies Meta<typeof ScreenTimeSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Counting on, the default pause and day start, one excluded app. */
export const Default: Story = {};

/** Counting switched off; the sliders stay editable for when it comes back. */
export const Off: Story = {
  parameters: {
    ipc: screenTimeService(emptySnapshot({ tracking: 'off' })),
    settings: (base) =>
      writeScreenTimeSettings(base, { ...defaultScreenTimeSettings(), enabled: false }),
  } satisfies MunaStoryParameters,
};

/** Nothing excluded yet: the list says where exclusions come from. */
export const NothingExcluded: Story = {
  parameters: {
    ipc: screenTimeService(sampleSnapshot({ excluded: [] })),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};
