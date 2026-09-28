import { defaultNotificationsSettings, writeNotificationsSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { notificationsSnapshot } from '../../storybook/samples';
import { useNotificationsStore } from './notifications-store';
import { NotificationsSettingsPane } from './settings';

const meta = {
  title: 'Modules/Notifications/Settings pane',
  component: NotificationsSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: {
      get_notifications_snapshot: () => notificationsSnapshot(),
      notifications_command: () => notificationsSnapshot(),
      notifications_open_settings: () => null,
    },
    settings: (base) =>
      writeNotificationsSettings(base, {
        ...defaultNotificationsSettings(),
        mutedApps: ['calendar'],
      }),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="notifications.title">
      <NotificationsSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useNotificationsStore.setState({
      snapshot: null,
      fresh: new Set(),
      pending: new Set(),
      errors: {},
    });
  },
} satisfies Meta<typeof NotificationsSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Access allowed with push delivery, both strip switches on, Calendar muted. */
export const Default: Story = {};

/** Unmuting Calendar removes the row; the section then says nothing is muted. */
export const Unmutes: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Unmute Calendar' }));
    await waitFor(async () => {
      await expect(
        canvas.queryByRole('button', { name: 'Unmute Calendar' }),
      ).not.toBeInTheDocument();
    });
  },
};

/** Without package identity Windows is polled: the delivery row explains the delay. */
export const Polling: Story = {
  parameters: {
    ipc: {
      get_notifications_snapshot: () => notificationsSnapshot({ delivery: 'polling' }),
      notifications_command: () => notificationsSnapshot({ delivery: 'polling' }),
      notifications_open_settings: () => null,
    },
  } satisfies MunaStoryParameters,
};

/** Access denied: the access row offers the Windows settings page. */
export const AccessDenied: Story = {
  parameters: {
    ipc: {
      get_notifications_snapshot: () =>
        notificationsSnapshot({ access: 'denied', delivery: null, unread: 0, groups: [] }),
      notifications_command: () => notificationsSnapshot({ access: 'denied' }),
      notifications_open_settings: () => null,
    },
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the access, strip and muted-apps sections. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
