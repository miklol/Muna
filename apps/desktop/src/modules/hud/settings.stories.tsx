import type { HudState } from '@muna/contracts';
import { defaultHudSettings, writeHudSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { hudState } from '../../storybook/samples';
import { useHudStore } from './hud-store';
import { HudSettingsPane } from './settings';

/**
 * A fake audio and display service: the levels come from the sample, and mute, microphone and
 * brightness commands are accepted silently — Rust would emit `HudStateChanged` next, which a
 * story does not.
 */
const hudService = (initial: HudState): IpcHandlers => ({
  get_hud_snapshot: () => initial,
  hud_set_muted: () => null,
  hud_set_mic_muted: () => null,
  hud_set_brightness: () => null,
  hud_set_volume: () => null,
  hud_nudge_volume: () => null,
});

const meta = {
  title: 'Modules/Volume and brightness/Settings pane',
  component: HudSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: hudService(hudState()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="hud.title">
      <HudSettingsPane />
    </SettingsPaneFrame>
  ),
  beforeEach: () => {
    useHudStore.setState({ state: null });
  },
} satisfies Meta<typeof HudSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Volume at 40 %, the microphone live, two displays with brightness, the Windows flyout showing. */
export const Default: Story = {};

/** The flyout is replaced: the status row says it is hidden while Muna runs. */
export const FlyoutReplaced: Story = {
  parameters: {
    ipc: hudService(hudState({ osd: 'suppressed' })),
  } satisfies MunaStoryParameters,
};

/** Output muted and the microphone muted: both switches on, the level track greyed. */
export const Muted: Story = {
  parameters: {
    ipc: hudService(hudState({ volume: { percent: 40, muted: true }, micMuted: true })),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('switch', { name: 'Mute' })).toBeChecked();
    await expect(canvas.getByRole('switch', { name: 'Mute microphone' })).toBeChecked();
  },
};

/** A laptop with no DDC/CI display and no microphone: the brightness section says so. */
export const NothingAdjustable: Story = {
  parameters: {
    ipc: hudService(hudState({ monitors: [], micMuted: null, osd: 'unavailable' })),
  } satisfies MunaStoryParameters,
};

/** Level text on and scrolling the strip nudging the volume. */
export const StripNudgesVolume: Story = {
  parameters: {
    settings: (base) =>
      writeHudSettings(base, {
        ...defaultHudSettings(),
        scrollOnStrip: 'volume',
        showLevelText: true,
      }),
  } satisfies MunaStoryParameters,
};

/** The mirrored-English pseudo-locale on the sliders, switches and the segmented control. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
