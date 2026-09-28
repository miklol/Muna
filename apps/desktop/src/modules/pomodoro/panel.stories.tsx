import type { PomodoroCommand, PomodoroState } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { MINUTE_MS, pomodoroIdle, pomodoroRunning } from '../../storybook/samples';
import { PomodoroPanel } from './panel';
import { usePomodoroStore } from './pomodoro-store';

/** A fake timer: start runs the phase, pause and resume flip the status, reset returns to idle. */
const pomodoroService = (initial: PomodoroState): IpcHandlers => ({
  get_pomodoro_snapshot: () => initial,
  pomodoro_command: (args) => {
    const { command } = args as { command: PomodoroCommand };
    switch (command.kind) {
      case 'start':
        return { ...initial, status: 'running' } satisfies PomodoroState;
      case 'pause':
        return { ...initial, status: 'paused' } satisfies PomodoroState;
      case 'resume':
        return { ...initial, status: 'running' } satisfies PomodoroState;
      case 'reset':
        return pomodoroIdle({ sessionsToday: initial.sessionsToday });
      case 'select':
        return pomodoroIdle({
          phase: command.phase,
          remainingMs: command.phase === 'work' ? 25 * MINUTE_MS : 5 * MINUTE_MS,
          totalMs: command.phase === 'work' ? 25 * MINUTE_MS : 5 * MINUTE_MS,
          sessionsToday: initial.sessionsToday,
        });
      case 'skip':
        return pomodoroIdle({
          phase: initial.phase === 'work' ? 'shortBreak' : 'work',
          remainingMs: initial.phase === 'work' ? 5 * MINUTE_MS : 25 * MINUTE_MS,
          totalMs: initial.phase === 'work' ? 5 * MINUTE_MS : 25 * MINUTE_MS,
          sessionsToday: initial.sessionsToday,
        });
    }
  },
});

const meta = {
  title: 'Modules/Pomodoro/Panel',
  component: PomodoroPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: pomodoroService(pomodoroIdle()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Pomodoro">
      <PomodoroPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    usePomodoroStore.setState({ state: null, receivedAt: 0 });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof PomodoroPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Ready to focus: the full ring, 25:00, *Start* and the phase presets. */
export const Idle: Story = {};

/** A focus session under way: the ring drains, two of four cycles done, three sessions today. */
export const Focusing: Story = {
  parameters: {
    ipc: pomodoroService(pomodoroRunning()),
  } satisfies MunaStoryParameters,
};

/** Paused mid-session: *Resume* takes the primary place. */
export const Paused: Story = {
  parameters: {
    ipc: pomodoroService(pomodoroRunning({ status: 'paused' })),
  } satisfies MunaStoryParameters,
};

/** A short break, green, with four minutes left. */
export const ShortBreak: Story = {
  parameters: {
    ipc: pomodoroService(
      pomodoroRunning({
        phase: 'shortBreak',
        remainingMs: 4 * MINUTE_MS,
        totalMs: 5 * MINUTE_MS,
        completedInCycle: 3,
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** Pressing *Start* asks Rust to run the phase; the panel follows the answer. */
export const Starts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Start' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'Pause' })).toBeVisible();
    });
  },
};

/** The mirrored-English pseudo-locale: the ring, presets and transport flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
