import { defaultMediaSettings, writeMediaSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { mediaSession, mediaSnapshot } from '../../storybook/samples';
import { useMediaStore } from './media-store';
import { MediaSettingsPane } from './settings';

const twoApps = mediaSnapshot(mediaSession(), [
  mediaSession({ sourceAppId: 'Chrome.exe', title: 'Rain', artist: 'Ambient', isCurrent: false }),
]);

const meta = {
  title: 'Modules/Media/Settings pane',
  component: MediaSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: {
      get_media_snapshot: () => twoApps,
      media_refresh: () => null,
    },
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="media.title">
      <MediaSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useMediaStore.setState({ state: null, receivedAt: 0, art: null });
  },
} satisfies Meta<typeof MediaSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two apps with sessions to prefer between, adaptive colours on, the bars visualiser. */
export const Default: Story = {};

/** Choosing an app over *Auto* saves it as the preferred source. */
export const PrefersAnApp: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const chrome = await canvas.findByRole('radio', { name: 'Google Chrome' });
    await userEvent.click(chrome);
    await expect(chrome).toBeChecked();
  },
};

/** The quiet look: adaptive colours off and the visualiser off. */
export const Quiet: Story = {
  parameters: {
    settings: (base) =>
      writeMediaSettings(base, {
        ...defaultMediaSettings(),
        adaptiveColours: false,
        visualiser: 'off',
      }),
  } satisfies MunaStoryParameters,
};

/** No session anywhere: only *Auto* is offered. */
export const NoSessions: Story = {
  parameters: {
    ipc: { get_media_snapshot: () => mediaSnapshot(null), media_refresh: () => null },
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the segmented rows and switches. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
