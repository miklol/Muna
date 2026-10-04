import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { AppearancePane } from './appearance';

const meta = {
  title: 'Settings/Appearance pane',
  component: AppearancePane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  args: {
    visible: () => true,
  },
  render: (args) => (
    <SettingsPaneFrame titleKey="settings.pane.appearance">
      <AppearancePane {...args} />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof AppearancePane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Blue accent, motion and contrast follow Windows, notices stay quiet for screen readers. */
export const Default: Story = {};

/** Purple chosen: the swatch carries its ring and is the checked radio. */
export const AccentChosen: Story = {
  parameters: {
    settings: (base) => ({ ...base, general: { ...base.general, accent: 'purple' } }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('radio', { name: 'Purple' })).toBeChecked();
  },
};

/**
 * Increase contrast on, in the setting and on the document: text goes to the stronger ramp,
 * hairlines and focus rings thicken (docs/05-design-system.md § Accessibility).
 */
export const IncreasedContrast: Story = {
  parameters: {
    settings: (base) => ({ ...base, general: { ...base.general, contrast: 'more' } }),
  } satisfies MunaStoryParameters,
  globals: { contrast: 'more' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('switch', { name: 'Increase contrast' })).toBeChecked();
  },
};

/** Reduce motion forced on from the setting rather than from Windows. */
export const ReduceMotionOn: Story = {
  parameters: {
    settings: (base) => ({ ...base, general: { ...base.general, reducedMotion: 'on' } }),
  } satisfies MunaStoryParameters,
  globals: { reduceMotion: 'on' },
};

/** Switching Announce notices on writes `general.announceNotices` and the row stays checked. */
export const AnnouncesNotices: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const announce = canvas.getByRole('switch', { name: 'Announce notices' });
    await expect(announce).not.toBeChecked();
    await userEvent.click(announce);
    await expect(announce).toBeChecked();
  },
};

/** The mirrored-English pseudo-locale on the swatch row, switches and section headers. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
