import type { Meta, StoryObj } from '@storybook/react-vite';

import { AlbumArt } from './album-art';
import { Text } from './text';

/** A stand-in cover: a gradient SVG so the story needs no binary asset. */
const cover = (from: string, to: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="96" height="96" fill="url(#g)"/><circle cx="48" cy="48" r="22" fill="rgba(0,0,0,0.35)"/><circle cx="48" cy="48" r="6" fill="${from}"/></svg>`,
  )}`;

const musicIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </svg>
);

const meta = {
  title: 'Primitives/AlbumArt',
  component: AlbumArt,
  parameters: { layout: 'centered' },
  args: {
    src: cover('#5ac8fa', '#bf5af2'),
    palette: ['#5ac8fa', '#bf5af2', '#1c1c1e'],
  },
  decorators: [
    (Story) => (
      <div style={{ padding: 'var(--space-8)' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AlbumArt>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The panel's 96 px art with the palette bled into the surface behind it (≤ 30 %). */
export const Adaptive: Story = {};

/** Adaptive colours off: the same art, no bleed. */
export const Plain: Story = {
  args: { adaptive: false },
};

/** Paused: art at 60 %. */
export const Dimmed: Story = {
  args: { dimmed: true },
};

/** No artwork yet, or an ad: the fallback glyph on `--surface-2`. */
export const Fallback: Story = {
  args: { src: null, palette: [], fallback: musicIcon },
};

/** Beside the text it belongs to, the way the media panel lays it out. */
export const WithMetadata: Story = {
  render: (args) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
      <AlbumArt {...args} />
      <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
        <Text variant="title3">Weird Fishes</Text>
        <Text variant="footnote" tone="secondary">
          Radiohead · In Rainbows
        </Text>
      </div>
    </div>
  ),
};
