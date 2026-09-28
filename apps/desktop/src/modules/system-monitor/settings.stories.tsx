import { defaultSystemMonitorSettings, writeSystemMonitorSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { SystemMonitorSettingsPane } from './settings';

const meta = {
  title: 'Modules/System monitor/Settings pane',
  component: SystemMonitorSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="systemMonitor.title">
      <SystemMonitorSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof SystemMonitorSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The CPU gauge kept out of the strip, five processes listed. */
export const Default: Story = {};

/** The strip gauge on and the process list hidden. */
export const StripOnly: Story = {
  parameters: {
    settings: (base) =>
      writeSystemMonitorSettings(base, {
        ...defaultSystemMonitorSettings(),
        showCpuInStrip: true,
        processCount: 0,
      }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the switch and the slider row. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
