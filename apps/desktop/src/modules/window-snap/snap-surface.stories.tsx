import type { DropPoint, Settings, WindowSnapSettings } from '@muna/contracts';
import { defaultWindowSnapSettings, writeWindowSnapSettings } from '@muna/contracts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { NotchSurface } from '@muna/ui/primitives';
import { useEffect, useState } from 'react';
import { expect, fn, waitFor, within } from 'storybook/test';

import type { MunaStoryParameters } from '../../storybook/ipc';
import { SnapSurface } from './snap-surface';
import { measureTiles } from './zones';

/** Off the zones: no tile is under the drag. */
const AWAY: DropPoint = { x: -1, y: -1 };

interface FramedProps {
  /** The tile the drag hovers, by key; measured once the tiles have laid out. */
  readonly over?: string;
  readonly ended?: boolean;
  readonly maxWidth?: number;
  readonly onDone: () => void;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The zones as the shell shows them: inside the expanded island's material, sized to the row
 * the way the shell's morph follows it, no wider than the panel. A window drag holds the
 * cursor, so a story hovers a tile by handing the surface that tile's centre as the drag
 * position, measured a frame after mount.
 */
function Framed({ over, ended = false, maxWidth = 1000, onDone }: FramedProps) {
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
        <SnapSurface
          session={1}
          position={position}
          ended={ended}
          maxWidth={maxWidth}
          onDone={onDone}
        />
      </div>
    </NotchSurface>
  );
}

const settingsWith =
  (recipe: (snap: WindowSnapSettings) => WindowSnapSettings) =>
  (base: Settings): Settings =>
    writeWindowSnapSettings(base, recipe(defaultWindowSnapSettings()));

const meta = {
  title: 'Modules/Window snap/Snap zones',
  component: Framed,
  parameters: {
    layout: 'centered',
    window: 'notch',
    ipc: {
      snap_apply: () => null,
      snap_cancel: () => true,
    },
  } satisfies MunaStoryParameters & { layout: string },
  args: { onDone: fn() },
  // The island floats over the desktop, not over another panel.
  globals: { backgrounds: { value: 'desktop' } },
} satisfies Meta<typeof Framed>;

export default meta;

type Story = StoryObj<typeof meta>;

/** All ten built-in zones, in strip order. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('group', { name: 'Snap zones' })).toBeVisible();
    await expect(canvas.getAllByText(/./, { selector: '.snap-tile__title' })).toHaveLength(10);
  },
};

/** The drag over a tile: it tints with `toggle`. */
export const Hovered: Story = {
  args: { over: 'builtIn:leftHalf' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Left half').closest('[data-tile-key]')).toHaveAttribute(
        'data-hovered',
      );
    });
  },
};

/** Halves and thirds only, as a two-monitor user might keep it. */
export const HalvesAndThirds: Story = {
  parameters: {
    settings: settingsWith((snap) => ({
      ...snap,
      zones: ['leftHalf', 'rightHalf', 'leftThird', 'centerThird', 'rightThird'],
    })),
  } satisfies MunaStoryParameters,
};

/** Two built-ins and a 2 × 3 grid: the cells follow the zones, each named by row and column. */
export const WithGrid: Story = {
  parameters: {
    settings: settingsWith((snap) => ({
      ...snap,
      zones: ['leftHalf', 'rightHalf'],
      grid: { rows: 2, cols: 3, gap: 8 },
    })),
  } satisfies MunaStoryParameters,
  args: { over: 'cell:1:2' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('Cell 2, 3').closest('[data-tile-key]')).toHaveAttribute(
        'data-hovered',
      );
    });
  },
};

/** The panel is narrower than the row wants: the tiles shrink evenly to fit. */
export const NarrowPanel: Story = {
  args: { maxWidth: 480 },
};

export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** The mirrored-English pseudo-locale (ar-XB): longer strings, right-to-left layout. */
export const PseudoRtl: Story = {
  globals: { locale: 'ar-XB' },
};
