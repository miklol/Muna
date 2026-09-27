import { writeMirrorSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { MirrorPanel } from './panel';
import { type CameraScenario, installStoryCamera } from './story-camera';

type MirrorStoryParameters = MunaStoryParameters & { camera?: CameraScenario };

const on = (deviceId: string | null = null, deviceLabel: string | null = null) =>
  ((base) =>
    writeMirrorSettings(base, {
      enabled: true,
      flip: true,
      deviceId,
      deviceLabel,
    })) satisfies MunaStoryParameters['settings'];

const meta = {
  title: 'Modules/Mirror/Panel',
  component: MirrorPanel,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: {
      mirror_watch: () => null,
      open_settings: () => null,
    },
    settings: on(),
    camera: 'live',
  } satisfies MirrorStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Mirror" width={720}>
      <MirrorPanel />
    </PanelFrame>
  ),
  // The story's camera is a painted canvas stream; a real one is never asked for.
  beforeEach: (context) =>
    installStoryCamera((context.parameters as MirrorStoryParameters).camera ?? 'live'),
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof MirrorPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The camera on, mirrored, at 1×: the picture fills a 16:9 frame under the controls. */
export const Live: Story = {};

/** Two cameras: the head gains *Next camera*, which switches and remembers the choice. */
export const TwoCameras: Story = {
  parameters: {
    camera: 'twoCameras',
  } satisfies MirrorStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Next camera' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { name: 'Desk camera' })).toBeVisible();
    });
  },
};

/** Zoomed to 2× and shown the way others see it (the mirror chip off). */
export const ZoomedUnmirrored: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Zoom 1' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Zoom 1.5' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Mirror the image' }));
    await expect(canvas.getByRole('button', { name: 'Zoom 2' })).toBeVisible();
  },
};

/** Waiting on the browser: the frame stands in for the picture. */
export const Starting: Story = {
  parameters: {
    camera: 'pending',
  } satisfies MirrorStoryParameters,
};

/** The module is off in Settings (the default); the panel says so and points there. */
export const Off: Story = {
  parameters: {
    settings: (base) => base,
  } satisfies MirrorStoryParameters,
};

/** Windows or a policy refused the camera. */
export const Denied: Story = {
  parameters: {
    camera: 'denied',
  } satisfies MirrorStoryParameters,
};

/** Nothing to open. */
export const NoCamera: Story = {
  parameters: {
    camera: 'notFound',
  } satisfies MirrorStoryParameters,
};

/** Another app holds the camera. */
export const Busy: Story = {
  parameters: {
    camera: 'busy',
  } satisfies MirrorStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
