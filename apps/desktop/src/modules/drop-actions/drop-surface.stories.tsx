import type { DropActionsSettings, DropItem, DropPoint, Settings } from '@muna/contracts';
import { defaultDropActionsSettings, writeDropActionsSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotchSurface } from '@muna/ui/primitives';
import { useEffect, useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';

import type { MunaStoryParameters } from '../../storybook/ipc';
import { DropSurface, measureTiles } from './drop-surface';

const files = (count: number, extension = 'pdf'): DropItem[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `file-${String(index + 1)}.${extension}`,
    extension,
    isDirectory: false,
  }));

/** Off the row: no tile is under the drag. */
const AWAY: DropPoint = { x: -1, y: -1 };

interface FramedProps {
  readonly items: readonly DropItem[];
  /** The tile the drag hovers, by key; measured once the tiles have laid out. */
  readonly over?: string;
  readonly dropped?: boolean;
  readonly maxWidth?: number;
  readonly onDone: () => void;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The row as the shell shows it: inside the expanded island's material, sized to the row the
 * way the shell's morph follows it (the surface is sized by its parent), no wider than the
 * panel. The drag is an OLE drag with no pointer events, so a story hovers a tile by handing
 * the surface that tile's centre as the drag position, measured a frame after mount.
 */
function Framed({ items, over, dropped = false, maxWidth = 1000, onDone }: FramedProps) {
  const [position, setPosition] = useState<DropPoint>(AWAY);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    if (root === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      setSize({ width: root.offsetWidth, height: root.offsetHeight });
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
    };
  }, [root]);
  useEffect(() => {
    // Measured once the island's size has landed and again whenever it changes: the centred
    // story shifts with it.
    if (size === null) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      const rect =
        over === undefined || root === null
          ? undefined
          : measureTiles(root).find((tile) => tile.key === over);
      setPosition(
        rect === undefined
          ? AWAY
          : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
      );
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [over, root, size]);
  return (
    <NotchSurface
      shape="island"
      state="expanded"
      style={size === null ? undefined : { width: size.width, height: size.height }}
    >
      <div ref={setRoot} className="w-max">
        <DropSurface
          session={1}
          items={items}
          position={position}
          dropped={dropped}
          maxWidth={maxWidth}
          onDone={onDone}
        />
      </div>
    </NotchSurface>
  );
}

const settingsWith =
  (recipe: (drop: DropActionsSettings) => DropActionsSettings) =>
  (base: Settings): Settings =>
    writeDropActionsSettings(base, recipe(defaultDropActionsSettings()));

const twoFolders = settingsWith((drop) => ({
  ...drop,
  folders: [
    { id: 'onedrive', name: 'OneDrive', path: 'C:\\Users\\me\\OneDrive', mode: 'copy' },
    { id: 'archive', name: 'Archive', path: 'D:\\Archive', mode: 'move' },
  ],
  tiles: [
    { kind: 'folder', id: 'onedrive' },
    { kind: 'folder', id: 'archive' },
    { kind: 'divider' },
    { kind: 'nearbyShare' },
    { kind: 'zip' },
    { kind: 'unzip' },
    { kind: 'reveal' },
    { kind: 'trash' },
  ],
}));

const meta = {
  title: 'Modules/Drop actions/Drop row',
  component: Framed,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: {
      drop_run: () => null,
      drop_cancel: () => null,
    },
  } satisfies MunaStoryParameters & { layout: string },
  args: { items: files(2), onDone: fn() },
  // The island floats over the desktop, not over another panel.
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof Framed>;

export default meta;

type Story = StoryObj<typeof meta>;

/**
 * Waits for the stagger to land: axe reads text at its animated opacity, so the contrast gate
 * only means something once every tile is fully opaque (the Unzip tile dims to 40 % on
 * purpose and is checked by `UnzipDimmed` at rest too).
 */
const atRest = async (canvasElement: HTMLElement) => {
  await waitFor(
    () => {
      const slots = canvasElement.querySelectorAll<HTMLElement>('.drop-tile-slot');
      if (slots.length === 0) {
        throw new Error('no tiles yet');
      }
      for (const slot of slots) {
        if (getComputedStyle(slot).opacity !== '1') {
          throw new Error('the tiles are still entering');
        }
      }
    },
    { timeout: 4000 },
  );
};

/** Four slots: the first three default tiles and More, which stands in for the other six. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
  },
};

/** The drag over a tile: it grows 1.04 with `toggle` and tints. */
export const Hovered: Story = {
  args: { over: 'copyTo' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Copy to').closest('[data-tile-key]')).toHaveAttribute(
        'data-hovered',
      );
    });
    await atRest(canvasElement);
  },
};

/** Reaching More reveals the rows past the first; four tiles per row. */
export const Revealed: Story = {
  args: { over: 'more' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Eject')).toBeVisible();
    });
    await atRest(canvasElement);
  },
};

/** Settings › Expand notch: eight per row, so the defaults need one row plus More. */
export const ExpandedNotch: Story = {
  parameters: {
    settings: settingsWith((drop) => ({ ...drop, expandNotch: true })),
  } satisfies MunaStoryParameters,
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
  },
};

/** Two user folders lead the row, a divider separates them from the built-ins. */
export const WithFolders: Story = {
  parameters: { settings: twoFolders } satisfies MunaStoryParameters,
  args: { over: 'more' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Recycle Bin')).toBeVisible();
    });
    await atRest(canvasElement);
  },
};

/** Unzip dims to 40 % when nothing dragged is an archive; a zip enables it. */
export const UnzipDimmed: Story = {
  parameters: {
    settings: settingsWith((drop) => ({
      ...drop,
      tiles: [{ kind: 'zip' }, { kind: 'unzip' }, { kind: 'reveal' }, { kind: 'trash' }],
    })),
    a11y: {
      config: {
        // The dimmed tile is a disabled control's affordance (aria-disabled, 40 % like every
        // disabled primitive in docs/05); its words are not meant to be read at that moment.
        rules: [{ id: 'color-contrast', enabled: false }],
      },
    },
  } satisfies MunaStoryParameters & { a11y: object },
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Unzip').closest('[data-tile-key]')).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  },
};

export const UnzipEnabled: Story = {
  parameters: {
    settings: settingsWith((drop) => ({
      ...drop,
      tiles: [{ kind: 'zip' }, { kind: 'unzip' }, { kind: 'reveal' }, { kind: 'trash' }],
    })),
  } satisfies MunaStoryParameters,
  args: { items: [...files(1), ...files(1, 'zip')] },
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Unzip').closest('[data-tile-key]')).not.toHaveAttribute(
      'aria-disabled',
    );
  },
};

/** One item: the row's label reads in the singular. */
export const OneItem: Story = {
  args: { items: files(1) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Drop 1 item on an action' })).toBeVisible();
    await atRest(canvasElement);
  },
};

/** The panel is narrower than the row wants: the tiles shrink evenly to fit. */
export const NarrowPanel: Story = {
  args: { maxWidth: 480 },
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
  },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  play: async ({ canvasElement }) => {
    await atRest(canvasElement);
  },
};
