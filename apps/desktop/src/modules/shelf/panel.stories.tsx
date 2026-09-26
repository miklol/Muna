import type { ShelfItem, ShelfSnapshot } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { PanelFrame } from '../../storybook/frames';
import type { IpcHandlers, MunaStoryParameters } from '../../storybook/ipc';
import { ShelfPanel } from './panel';
import { useShelfStore } from './shelf-store';

const NOW = 1_770_000_000_000;

/** A 64 × 64 PNG drawn in the story: a warm gradient card that stands in for Explorer's thumbnail. */
const thumbnail = (hue: number): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context === null) return '';
  const gradient = context.createLinearGradient(0, 0, 64, 64);
  gradient.addColorStop(0, `hsl(${String(hue)} 70% 60%)`);
  gradient.addColorStop(1, `hsl(${String(hue + 40)} 70% 35%)`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return canvas.toDataURL('image/png');
};

let nextId = 0;
const file = (overrides: Partial<ShelfItem> & { name: string }): ShelfItem => ({
  id: `s${String(++nextId)}`,
  kind: 'file',
  extension: overrides.name.includes('.') ? (overrides.name.split('.').pop() ?? null) : null,
  size: 1_200_000,
  isFolder: false,
  copied: false,
  missing: false,
  preview: null,
  addedAtMs: NOW - nextId * 60_000,
  ...overrides,
});
const snippet = (text: string): ShelfItem => ({
  id: `s${String(++nextId)}`,
  kind: 'text',
  name: text.split('\n')[0] ?? text,
  extension: null,
  size: null,
  isFolder: false,
  copied: false,
  missing: false,
  preview: text,
  addedAtMs: NOW - nextId * 60_000,
});

const pictures: readonly string[] = ['IMG_2041.jpg', 'IMG_2042.jpg', 'Poster draft.png'];

const items = (): ShelfItem[] => {
  nextId = 0;
  return [
    file({ name: 'Q3 report.pdf', copied: true }),
    ...pictures.map((name) => file({ name })),
    file({ name: 'Photos', isFolder: true, size: null }),
    snippet('https://github.com/miklol/Muna/pull/40'),
    file({ name: 'notes-from-the-call-with-the-design-team-2026-09.md', size: 8_192 }),
    snippet('Pick up the prints before 6, then send Sam the invoice number.'),
    file({ name: 'Archive.zip', size: 48_000_000 }),
    file({ name: 'old-deck.pptx', missing: true }),
  ];
};

/** A fake `shelf` service: items in memory, thumbnails for the pictures, every command applied. */
const shelfService = (initial: ShelfItem[]): IpcHandlers => {
  let current = initial;
  const hues = new Map(initial.map((item, index) => [item.id, (index * 47) % 360]));
  const snapshot = (): ShelfSnapshot => ({
    items: current,
    settings: { copyIntoStorage: false, expiryDays: 0 },
  });
  return {
    get_shelf_snapshot: snapshot,
    shelf_thumbnail: (args) => {
      const { id } = args as { id: string };
      const item = current.find((candidate) => candidate.id === id);
      const picture = item !== undefined && !item.isFolder && /\.(?:jpg|png)$/u.test(item.name);
      return picture ? thumbnail(hues.get(id) ?? 0) : null;
    },
    shelf_command: (args) => {
      const { command } = args as {
        command:
          | { kind: 'addText'; text: string }
          | { kind: 'remove'; ids: string[] }
          | { kind: 'removeMissing' }
          | { kind: 'clear' }
          | { kind: 'open' | 'reveal' | 'copy' };
      };
      switch (command.kind) {
        case 'addText':
          current = [{ ...snippet(command.text), addedAtMs: Date.now() }, ...current];
          break;
        case 'remove':
          current = current.filter((item) => !command.ids.includes(item.id));
          break;
        case 'removeMissing':
          current = current.filter((item) => !item.missing);
          break;
        case 'clear':
          current = [];
          break;
        default:
          break;
      }
      return snapshot();
    },
    drag_out: () => ({ kind: 'cancelled' }),
  };
};

const meta = {
  title: 'Modules/Shelf/Panel',
  component: ShelfPanel,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: shelfService(items()),
  } satisfies MunaStoryParameters & { layout: string },
  render: () => (
    <PanelFrame title="Shelf">
      <ShelfPanel />
    </PanelFrame>
  ),
  // Every story starts unselected; the selection outlives the panel in the store otherwise.
  beforeEach: () => {
    useShelfStore.setState({ snapshot: null, selected: [] });
  },
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof ShelfPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A day's worth of drops: a copied report, pictures with thumbnails, a folder, two snippets, a missing file. */
export const Default: Story = {};

/** A fresh Shelf: the dashed zone says how items get here. */
export const Empty: Story = {
  parameters: { ipc: shelfService([]) } satisfies MunaStoryParameters,
};

/** Two tiles selected: the status counts them and *Show in Explorer* appears. */
export const Selected: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('option', { name: 'Q3 report.pdf' }));
    await userEvent.click(canvas.getByRole('option', { name: 'IMG_2041.jpg' }));
    await expect(canvas.getByText('2 of 10 selected')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Show in Explorer' })).toBeVisible();
  },
};

/** Files that have gone: broken links, struck-through names and *Remove missing* in one go. */
export const MissingFiles: Story = {
  parameters: {
    ipc: shelfService([
      file({ name: 'old-deck.pptx', missing: true }),
      file({ name: 'Screenshot 2026-09-01.png', missing: true }),
      file({ name: 'still-here.pdf' }),
    ]),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: 'Remove 2 missing' })).toBeVisible();
  },
};

/** A pasted link lands as a new tile at the front and the field clears. */
export const PastingALink: Story = {
  parameters: { ipc: shelfService([]) } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByRole('textbox', { name: 'Paste text or a link, then Enter' });
    await userEvent.type(field, 'https://example.com/a-link{enter}');
    await expect(
      await canvas.findByRole('option', { name: 'https://example.com/a-link' }),
    ).toBeVisible();
    await expect(field).toHaveValue('');
  },
};

/** Long names wrap to two lines and end in an ellipsis; the grid never grows past two rows. */
export const LongContent: Story = {
  parameters: {
    ipc: shelfService(
      Array.from({ length: 24 }, (_, index) =>
        file({
          name: `A very long file name that keeps going and going ${String(index + 1)}.pdf`,
          size: index * 100_000,
        }),
      ),
    ),
  } satisfies MunaStoryParameters,
};

export const RTL: Story = {
  globals: { direction: 'rtl' },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
