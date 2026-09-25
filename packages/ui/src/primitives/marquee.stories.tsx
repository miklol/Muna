import type { Meta, StoryObj } from '@storybook/react-vite';

import { Marquee } from './marquee';
import { Text } from './text';

const meta = {
  title: 'Primitives/Marquee',
  component: Marquee,
  parameters: { layout: 'padded' },
  args: {
    children: 'Everything in its right place — a title long enough to overflow the strip',
  },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 240 }}>
        <Text as="div" variant="footnote" weight={600}>
          <Story />
        </Text>
      </div>
    ),
  ],
} satisfies Meta<typeof Marquee>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Waits 1.5 s, scrolls at 40 px/s, pauses 1.5 s, snaps back. */
export const Overflowing: Story = {};

/** Text that fits never moves. */
export const Fits: Story = {
  args: { children: 'Short title' },
};

/** Reduced motion: clipped with an ellipsis, no scroll. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};
