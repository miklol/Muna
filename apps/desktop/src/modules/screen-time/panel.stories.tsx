import type { ScreenTimeCommand, ScreenTimeSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { ScreenTimePanel } from './panel';
import { emptySnapshot, sampleSnapshot } from './sample-snapshot';
import { useScreenTimeStore } from './screen-time-store';

/**
 * A fake screen time service for the panel. Commands answer with the same day, changed the way
 * Rust would change it: a limit or a category sticks to the app, an exclusion removes it.
 */
const screenTimeService = (initial: ScreenTimeSnapshot): IpcHandlers => ({
  get_screen_time_snapshot: () => initial,
  screen_time_watch: () => null,
  screen_time_command: (args) => {
    const { command } = args as { command: ScreenTimeCommand };
    switch (command.kind) {
      case 'setLimit':
        return sampleSnapshot({
          ...initial,
          apps: initial.apps.map((app) =>
            app.exe === command.exe
              ? {
                  ...app,
                  limitMinutes: command.minutes,
                  limitReached: command.minutes !== null && app.totalMs >= command.minutes * 60_000,
                }
              : app,
          ),
        });
      case 'setCategory':
        return sampleSnapshot({
          ...initial,
          apps: initial.apps.map((app) =>
            app.exe === command.exe ? { ...app, category: command.category ?? app.category } : app,
          ),
        });
      case 'exclude':
        return sampleSnapshot({
          ...initial,
          apps: initial.apps.filter((app) => app.exe !== command.exe),
          excluded: [
            ...initial.excluded,
            ...initial.apps
              .filter((app) => app.exe === command.exe)
              .map((app) => ({ exe: app.exe, name: app.name })),
          ],
        });
      case 'refresh':
      case 'include':
      case 'clearHistory':
        return initial;
    }
  },
  open_settings: () => null,
});

const meta = {
  title: 'Modules/Screen time/Panel',
  component: ScreenTimePanel,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: screenTimeService(sampleSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Screen time">
      <ScreenTimePanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useScreenTimeStore.setState({ snapshot: null, receivedAt: 0 });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof ScreenTimePanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A Tuesday afternoon: the donut by category, the app in front and the ranking with a limit. */
export const Default: Story = {};

/** *Week* swaps the ranking for the last seven days, today last, and the daily average. */
export const Week: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Week' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('region', { name: 'Last 7 days' })).toBeVisible();
    });
  },
};

/** An app row opens its details: sessions, category chips and the daily limit presets. */
export const Detail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: /^Steam/ }));
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { name: 'Steam' })).toBeVisible();
    });
  },
};

/** No input for a while: the count is paused and the *Now* card says so. */
export const Away: Story = {
  parameters: {
    ipc: screenTimeService(sampleSnapshot({ now: null, tracking: 'idle' })),
  } satisfies MunaStoryParameters,
};

/** The session is locked: nothing counts until it is unlocked. */
export const Locked: Story = {
  parameters: {
    ipc: screenTimeService(sampleSnapshot({ now: null, tracking: 'locked' })),
  } satisfies MunaStoryParameters,
};

/** Counting is switched off in Settings; the panel points there. */
export const Off: Story = {
  parameters: {
    ipc: screenTimeService(emptySnapshot({ tracking: 'off' })),
  } satisfies MunaStoryParameters,
};

/** Right after the day reset, before any app has been in front. */
export const Empty: Story = {
  parameters: {
    ipc: screenTimeService(emptySnapshot()),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
