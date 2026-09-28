import { defaultWindowSnapSettings, writeWindowSnapSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { MunaStoryParameters } from '../../storybook/ipc';
import { WindowSnapSettingsPane } from './settings';

const meta = {
  title: 'Modules/Window snap/Settings pane',
  component: WindowSnapSettingsPane,
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="windowSnap.title">
      <WindowSnapSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof WindowSnapSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh install: every built-in zone on, no grid — ten of ten. */
export const Default: Story = {};

/** Two zones and a 2 × 4 grid: full, so the zones that are off cannot come on. */
export const WithGrid: Story = {
  parameters: {
    settings: (base) =>
      writeWindowSnapSettings(base, {
        ...defaultWindowSnapSettings(),
        zones: ['leftHalf', 'rightHalf'],
        grid: { rows: 2, cols: 4, gap: 8 },
      }),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('10 of 10')).toBeVisible();
    await expect(canvas.getByRole('switch', { name: 'Maximise' })).toBeDisabled();
  },
};

/** Switching the grid on trims the zones to fit and reveals the rows, columns and gap. */
export const TurningTheGridOn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('switch', { name: 'Show a grid' }));
    await expect(await canvas.findByRole('slider', { name: 'Gap' })).toBeVisible();
    await expect(canvas.getByText('10 of 10')).toBeVisible();
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
