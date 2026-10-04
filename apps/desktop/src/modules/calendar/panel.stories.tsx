import type { CalendarSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { calendarSnapshot, calendarSources } from '../../storybook/samples';
import { useCalendarStore } from './calendar-store';
import { CalendarPanel } from './panel';

/** A fake calendar service: refresh answers with the same agenda, opening a link is a no-op. */
const calendarService = (initial: CalendarSnapshot): IpcHandlers => ({
  get_calendar_snapshot: () => initial,
  calendar_command: () => ({ ...initial, offline: false }),
  calendar_open: () => null,
  open_settings: () => null,
});

const meta = {
  title: 'Modules/Calendar/Panel',
  component: CalendarPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: calendarService(calendarSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Calendar">
      <CalendarPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useCalendarStore.setState({ snapshot: null });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof CalendarPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Today: the month with a dot per event, the agenda with a meeting under way and *Join*. */
export const Default: Story = {};

/** Tomorrow selected from the grid: the all-day offsite is the whole agenda. */
export const Tomorrow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = await canvas.findByRole('grid', { name: /^Month/ });
    await userEvent.click(within(grid).getByRole('button', { name: /^Today/ }));
    await userEvent.keyboard('{ArrowRight}{Enter}');
    await waitFor(async () => {
      await expect(canvas.getByText('Team offsite')).toBeVisible();
    });
  },
};

/** Offline: the cached agenda stays and a chip says so, never a dialog. */
export const Offline: Story = {
  parameters: {
    ipc: calendarService(calendarSnapshot({ offline: true })),
  } satisfies MunaStoryParameters,
};

/** One feed refuses: the attention chip points at Settings, the other calendar still shows. */
export const FeedNeedsAttention: Story = {
  parameters: {
    ipc: calendarService(
      calendarSnapshot({
        sources: [
          { ...calendarSources.work, status: { kind: 'error', error: 'refused' }, eventCount: 0 },
          calendarSources.home,
        ],
      }),
    ),
  } satisfies MunaStoryParameters,
};

/** No calendar subscribed yet: the empty state says how to add one. */
export const Empty: Story = {
  parameters: {
    ipc: calendarService(calendarSnapshot({ sources: [], events: [] })),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the grid, the agenda and the join button flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
