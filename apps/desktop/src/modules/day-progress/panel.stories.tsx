import type { Settings } from '@muna/contracts';
import { defaultDayProgressSettings, writeDayProgressSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { pomodoroIdle, pomodoroRunning, todoSnapshot } from '../../storybook/samples';
import { DayProgressPanel } from './panel';

/**
 * The two contracts the timeline reads — today's tasks and the pomodoro — as Rust would answer
 * them. The story's working day runs from an hour ago to the end of the calendar day, so the
 * "now" marker always lands inside it.
 */
const daySources: IpcHandlers = {
  get_todo_snapshot: () => todoSnapshot(),
  get_pomodoro_snapshot: () => pomodoroRunning(),
};

/** A working day that always contains the current minute: from the previous full hour on. */
const workingDayAroundNow = (base: Settings): Settings => {
  const now = new Date();
  const start = Math.max(0, now.getHours() - 1) * 60;
  return writeDayProgressSettings(base, {
    ...defaultDayProgressSettings(),
    workStartMinutes: start,
    workEndMinutes: Math.min(23 * 60 + 59, start + 9 * 60),
    bedtimeMinutes: 23 * 60,
  });
};

const meta = {
  title: 'Modules/Day progress/Panel',
  component: DayProgressPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: daySources,
    settings: workingDayAroundNow,
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Day">
      <DayProgressPanel />
    </PanelFrame>
  ),
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof DayProgressPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Mid-day: the stats, a done task behind the now marker, a focus session and a task ahead. */
export const Default: Story = {};

/** Nothing scheduled and no focus session: the empty state offers to add a task. */
export const Empty: Story = {
  parameters: {
    ipc: {
      get_todo_snapshot: () => todoSnapshot({ tasks: [] }),
      get_pomodoro_snapshot: () => pomodoroIdle(),
    },
    settings: (base): Settings =>
      writeDayProgressSettings(base, {
        ...defaultDayProgressSettings(),
        showFocusSessions: false,
      }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the stats, the timeline and its now marker flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
