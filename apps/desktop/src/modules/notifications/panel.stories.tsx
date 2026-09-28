import type { NotificationsCommand, NotificationsSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { notificationsSnapshot } from '../../storybook/samples';
import { useNotificationsStore } from './notifications-store';
import { NotificationsPanel } from './panel';

/**
 * A fake notification centre that remembers what happened: dismissing takes the card out
 * (and the sender with its last card), clearing an app or everything empties the list,
 * marking read clears the dots and the count, and asking for access is granted at once.
 * Stateful on purpose: the panel marks read whenever the count is above zero, so a fake that
 * answered from the seed would keep bringing dismissed senders back.
 */
const notificationsService = (initial: NotificationsSnapshot): IpcHandlers => {
  let current = initial;
  return {
    // Each mount reads the snapshot first, which re-seeds the fake for the next story.
    get_notifications_snapshot: () => {
      current = initial;
      return current;
    },
    notifications_command: (args) => {
      const { command } = args as { command: NotificationsCommand };
      switch (command.kind) {
        case 'dismiss':
          current = {
            ...current,
            groups: current.groups
              .map((group) => ({
                ...group,
                notifications: group.notifications.filter((view) => view.id !== command.id),
              }))
              .filter((group) => group.notifications.length > 0),
          };
          break;
        case 'dismissApp':
          current = {
            ...current,
            groups: current.groups.filter((group) => group.appId !== command.appId),
          };
          break;
        case 'clear':
          current = { ...current, unread: 0, groups: [] };
          break;
        case 'markRead':
          current = {
            ...current,
            unread: 0,
            groups: current.groups.map((group) => ({
              ...group,
              notifications: group.notifications.map((view) => ({ ...view, unread: false })),
            })),
          };
          break;
        case 'requestAccess':
          current = { ...current, access: 'allowed' };
          break;
        case 'refresh':
        case 'open':
          break;
      }
      return current;
    },
    notifications_open_settings: () => null,
  };
};
const meta = {
  title: 'Modules/Notifications/Panel',
  component: NotificationsPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: notificationsService(notificationsSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Notifications">
      <NotificationsPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useNotificationsStore.setState({
      snapshot: null,
      fresh: new Set(),
      pending: new Set(),
      errors: {},
    });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof NotificationsPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Three senders, two unread, one muted; the newest sender on top. */
export const Default: Story = {};

/** Dismissing a card slides it out; the sender goes with its last card. */
export const Dismisses: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Dismiss Invoice 2026-09' }));
    await waitFor(async () => {
      await expect(canvas.queryByRole('region', { name: 'Mail' })).not.toBeInTheDocument();
    });
  },
};

/** A Windows focus session is on: the chip says so above the list. */
export const FocusOn: Story = {
  parameters: {
    ipc: notificationsService(notificationsSnapshot({ focusActive: true })),
  } satisfies MunaStoryParameters,
};

/** Access not decided yet: the panel asks, and Windows shows its prompt. */
export const AccessUnspecified: Story = {
  parameters: {
    ipc: notificationsService(
      notificationsSnapshot({ access: 'unspecified', delivery: null, unread: 0, groups: [] }),
    ),
  } satisfies MunaStoryParameters,
};

/** Access denied in Windows settings: the panel points there and offers a re-check. */
export const AccessDenied: Story = {
  parameters: {
    ipc: notificationsService(
      notificationsSnapshot({ access: 'denied', delivery: null, unread: 0, groups: [] }),
    ),
  } satisfies MunaStoryParameters,
};

/** Nothing waiting: the quiet empty state. */
export const Empty: Story = {
  parameters: {
    ipc: notificationsService(notificationsSnapshot({ unread: 0, groups: [] })),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: cards, times and the per-sender actions flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
