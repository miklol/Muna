import type { MediaSnapshot } from '@muna/contracts';
import { defaultMediaSettings, writeMediaSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { mediaSession, mediaSnapshot } from '../../storybook/samples';
import { useMediaStore } from './media-store';
import { MediaPanel } from './panel';

/**
 * A fake media service: the session comes from the sample, transport commands are accepted
 * silently — Windows would answer through `MediaStateChanged` next — and pinning answers with
 * the same state, pinned.
 */
const mediaService = (initial: MediaSnapshot): IpcHandlers => ({
  get_media_snapshot: () => initial,
  media_command: () => null,
  media_pin: (args) => {
    const { sourceAppId } = args as { sourceAppId: string | null };
    return { ...initial.state, pinned: sourceAppId };
  },
});

const meta = {
  title: 'Modules/Media/Panel',
  component: MediaPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: mediaService(mediaSnapshot()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Media">
      <MediaPanel />
    </PanelFrame>
  ),
  beforeEach: () => {
    useMediaStore.setState({ state: null, receivedAt: 0, art: null });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof MediaPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Playing: the artwork, the title on a marquee, the seek track and the full transport. */
export const Playing: Story = {};

/** Paused: the play glyph and a still position. */
export const Paused: Story = {
  parameters: {
    ipc: mediaService(mediaSnapshot(mediaSession({ status: 'paused' }))),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Play' })).toBeVisible();
  },
};

/** Two apps with sessions: the second one waits under the transport and can be pinned. */
export const TwoApps: Story = {
  parameters: {
    ipc: mediaService(
      mediaSnapshot(mediaSession(), [
        mediaSession({
          sourceAppId: 'Chrome.exe',
          title: 'Rain on a tin roof, 3 hours',
          artist: 'Ambient Worlds',
          album: null,
          status: 'paused',
          isCurrent: false,
          controls: {
            play: true,
            pause: true,
            next: false,
            previous: false,
            seek: false,
            shuffle: false,
            repeat: false,
          },
        }),
      ]),
    ),
  } satisfies MunaStoryParameters,
};

/** A stream with no duration and no seek: the track becomes indeterminate. */
export const LiveStream: Story = {
  parameters: {
    ipc: mediaService(
      mediaSnapshot(
        mediaSession({
          title: 'Morning show',
          artist: 'Radio Nova',
          album: null,
          positionMs: null,
          durationMs: null,
          controls: {
            play: true,
            pause: true,
            next: false,
            previous: false,
            seek: false,
            shuffle: false,
            repeat: false,
          },
        }),
      ),
    ),
  } satisfies MunaStoryParameters,
};

/** Adaptive colours off: the neutral panel with the same artwork. */
export const NeutralColours: Story = {
  parameters: {
    settings: (base) =>
      writeMediaSettings(base, { ...defaultMediaSettings(), adaptiveColours: false }),
  } satisfies MunaStoryParameters,
};

/** Nothing is playing anywhere: the empty state. */
export const Empty: Story = {
  parameters: {
    ipc: mediaService(mediaSnapshot(null)),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale: the transport order and the marquee direction flip. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
