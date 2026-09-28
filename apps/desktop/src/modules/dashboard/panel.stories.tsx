import type { Settings } from '@muna/contracts';
import { defaultDashboardSettings, writeDashboardSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import {
  bluetoothSnapshot,
  mediaSnapshot,
  pomodoroRunning,
  systemMonitorSnapshot,
  todoSnapshot,
  weatherSnapshot,
} from '../../storybook/samples';
import { DashboardPanel } from './panel';

/**
 * Every widget's service at once: the dashboard composes the other modules' widgets through the
 * registry, so the story feeds each of them the sample it would get from Rust. Commands the
 * widgets could send (play, pause) answer with the same state. The widgets' own stores are not
 * reset here — the dashboard never imports another module (ADR-0004), and each widget replaces
 * whatever an earlier story left as soon as its snapshot arrives.
 */
const widgetServices: IpcHandlers = {
  get_media_snapshot: () => mediaSnapshot(),
  media_command: () => null,
  media_pin: () => mediaSnapshot().state,
  get_pomodoro_snapshot: () => pomodoroRunning(),
  pomodoro_command: () => pomodoroRunning(),
  get_todo_snapshot: () => todoSnapshot(),
  todo_command: () => todoSnapshot(),
  get_weather_snapshot: () => weatherSnapshot(),
  weather_command: () => weatherSnapshot(),
  system_monitor_watch: () => systemMonitorSnapshot(),
  get_bluetooth_snapshot: () => bluetoothSnapshot(),
  bluetooth_command: () => bluetoothSnapshot(),
};

const meta = {
  title: 'Modules/Dashboard/Panel',
  component: DashboardPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: widgetServices,
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Dashboard" height={360}>
      <DashboardPanel />
    </PanelFrame>
  ),
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof DashboardPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The default grid: media across two cells, then pomodoro, tasks, weather, day, system, Bluetooth. */
export const Default: Story = {};

/** Edit mode: every card grows arrange controls and the free cells offer what is not shown. */
export const Editing: Story = {
  parameters: {
    settings: (base): Settings =>
      writeDashboardSettings(base, {
        ...defaultDashboardSettings(),
        slots: [
          { moduleId: 'media', span: 2 },
          { moduleId: 'pomodoro', span: 1 },
          { moduleId: 'todo', span: 1 },
        ],
      }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Edit layout' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('group', { name: 'Add a widget' })).toBeVisible();
    });
  },
};

/** Every widget removed: the empty state says how to bring them back. */
export const Empty: Story = {
  parameters: {
    settings: (base): Settings =>
      writeDashboardSettings(base, { ...defaultDashboardSettings(), slots: [] }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the grid, every widget and the arrange controls flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
