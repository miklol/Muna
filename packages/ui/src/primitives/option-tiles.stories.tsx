import type { Meta, StoryObj } from '@storybook/react-vite';
import { type CSSProperties, useState } from 'react';
import { fn } from 'storybook/test';

import { NotchSurface } from './notch-surface';
import { type OptionTileItem, OptionTiles } from './option-tiles';

type Shape = 'notch' | 'island';
type Placement = 'overlay' | 'reserved';

/** A 96 × 56 desktop with the strip hanging from its top edge, drawn from tokens only. */
function ShapeArt({ shape }: { shape: Shape }) {
  const screen: CSSProperties = {
    position: 'relative',
    inlineSize: 96,
    blockSize: 56,
    borderRadius: 'var(--radius-control)',
    background: 'var(--surface-3)',
    overflow: 'hidden',
  };
  return (
    <span style={screen}>
      <NotchSurface
        shape={shape}
        state="collapsed"
        style={{
          position: 'absolute',
          insetBlockStart: shape === 'island' ? 3 : 0,
          insetInlineStart: '50%',
          translate: '-50% 0',
          inlineSize: 44,
          blockSize: 12,
        }}
      />
    </span>
  );
}

const notchTile: OptionTileItem<Shape> = {
  id: 'notch',
  title: 'Notch',
  description: 'Sits flush with the top edge, like a MacBook.',
  illustration: <ShapeArt shape="notch" />,
};

const islandTile: OptionTileItem<Shape> = {
  id: 'island',
  title: 'Island',
  description: 'Floats a little below the edge as a capsule.',
  illustration: <ShapeArt shape="island" />,
};

const shapes: readonly OptionTileItem<Shape>[] = [notchTile, islandTile];

const placements: readonly OptionTileItem<Placement>[] = [
  {
    id: 'overlay',
    title: 'Overlay',
    description: 'Draws over windows and steps aside for title bars and full-screen apps.',
  },
  {
    id: 'reserved',
    title: 'Reserved',
    description: 'Keeps a band free so maximised windows start below the strip.',
  },
];

function ControlledShapes(props: {
  isDisabled?: boolean;
  items?: readonly OptionTileItem<Shape>[];
}) {
  const [value, setValue] = useState<Shape>('notch');
  return (
    <div style={{ inlineSize: 400 }}>
      <OptionTiles
        aria-label="Shape"
        items={props.items ?? shapes}
        value={value}
        onChange={setValue}
        isDisabled={props.isDisabled === true}
      />
    </div>
  );
}

function ControlledPlacements() {
  const [value, setValue] = useState<Placement>('overlay');
  return (
    <div style={{ inlineSize: 400 }}>
      <OptionTiles aria-label="Placement" items={placements} value={value} onChange={setValue} />
    </div>
  );
}

const meta = {
  title: 'Primitives/OptionTiles',
  component: OptionTiles,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Shape', items: shapes, value: 'notch', onChange: fn() },
  render: () => <ControlledShapes />,
} satisfies Meta<typeof OptionTiles>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Two tiles with token-drawn art; the selected one carries the accent ring and a check. */
export const Default: Story = {};

/** Text-only tiles: title, one line of description, the check in the corner. */
export const WithoutIllustration: Story = {
  render: () => <ControlledPlacements />,
};

export const TileDisabled: Story = {
  render: () => <ControlledShapes items={[notchTile, { ...islandTile, isDisabled: true }]} />,
};

export const Disabled: Story = {
  render: () => <ControlledShapes isDisabled />,
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 320 }}>
      <OptionTiles
        aria-label="Placement"
        items={[
          {
            id: 'overlay',
            title: 'Overlay, the default for laptops and single screens',
            description:
              'Draws over windows, fades to a thin line while a title bar or a browser tab strip sits under it, and steps aside for full-screen apps and games.',
          },
          {
            id: 'reserved',
            title: 'Reserved',
            description: 'Keeps a band free.',
          },
        ]}
        value="overlay"
        onChange={fn()}
      />
    </div>
  ),
};

/** Reduced motion: ring and check appear without easing; press no longer scales. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ inlineSize: 400 }}>
      <OptionTiles
        aria-label="الشكل"
        items={[
          {
            id: 'notch',
            title: 'نوتش',
            description: 'ملاصق للحافة العلوية.',
            illustration: <ShapeArt shape="notch" />,
          },
          {
            id: 'island',
            title: 'جزيرة',
            description: 'تطفو قليلاً تحت الحافة.',
            illustration: <ShapeArt shape="island" />,
          },
        ]}
        value="island"
        onChange={fn()}
      />
    </div>
  ),
};
