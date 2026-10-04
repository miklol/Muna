import { defaultPomodoroSettings, writePomodoroSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { PomodoroSettingsPane } from './settings';

const meta = {
  title: 'Modules/Pomodoro/Settings pane',
  component: PomodoroSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="pomodoro.title">
      <PomodoroSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof PomodoroSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The classic 25 / 5 / 15 with a long break every four sessions, nothing auto-starting. */
export const Default: Story = {};

/** Longer sessions with auto-start on: 50 / 10 / 30, a long break every two. */
export const DeepWork: Story = {
  parameters: {
    settings: (base) =>
      writePomodoroSettings(base, {
        ...defaultPomodoroSettings(),
        workMinutes: 50,
        shortBreakMinutes: 10,
        longBreakMinutes: 30,
        longBreakEvery: 2,
        autoStartNext: true,
      }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the slider rows and the switch. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
