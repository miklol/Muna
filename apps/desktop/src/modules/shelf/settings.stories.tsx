import type { ShelfSnapshot } from '@muna/contracts';
import { writeShelfSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SettingsPaneFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { ShelfSettingsPane } from './settings';

/** A fake `shelf` service with `count` items; *Clear* empties it. */
const shelfService = (count: number): IpcHandlers => {
  let items = Array.from({ length: count }, (_, index) => ({
    id: `s${String(index)}`,
    kind: 'file' as const,
    name: `file-${String(index + 1)}.pdf`,
    extension: 'pdf',
    size: 1_024,
    isFolder: false,
    copied: false,
    missing: false,
    preview: null,
    addedAtMs: index,
  }));
  const snapshot = (): ShelfSnapshot => ({
    items,
    settings: { copyIntoStorage: false, expiryDays: 0 },
  });
  return {
    get_shelf_snapshot: snapshot,
    shelf_command: () => {
      items = [];
      return snapshot();
    },
  };
};

const meta = {
  title: 'Modules/Shelf/Settings pane',
  component: ShelfSettingsPane,
  // Object literals only: Storybook's CSF indexer cannot read a helper call here.
  parameters: {
    layout: 'fullscreen',
    window: 'settings',
    ipc: shelfService(12),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <SettingsPaneFrame titleKey="shelf.title">
      <ShelfSettingsPane />
    </SettingsPaneFrame>
  ),
} satisfies Meta<typeof ShelfSettingsPane>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A fresh install: files are referenced, items never expire, a dozen items on the Shelf. */
export const Default: Story = {};

/** Copies on and a week's expiry, as a user who drops screenshots all day would set it. */
export const CopiesAndExpiry: Story = {
  parameters: {
    settings: (base) => writeShelfSettings(base, { copyIntoStorage: true, expiryDays: 7 }),
  } satisfies MunaStoryParameters,
};

/** Clearing removes every item and the button rests until something arrives. */
export const Clearing: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('12 items')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Clear' }));
    await expect(await canvas.findByText('0 items')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Clear' })).toBeDisabled();
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
