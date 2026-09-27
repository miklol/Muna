import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from 'react-aria-components';

import { type RingSegment, SegmentedRing } from './segmented-ring';
import { Text } from './text';

const categories: readonly RingSegment[] = [
  { id: 'browsing', value: 42, tint: 'blue' },
  { id: 'development', value: 55, tint: 'purple' },
  { id: 'communication', value: 13, tint: 'green' },
  { id: 'other', value: 8, tint: 'neutral' },
];

const meta = {
  title: 'Primitives/SegmentedRing',
  component: SegmentedRing,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Time by category', diameter: 96, segments: categories },
} satisfies Meta<typeof SegmentedRing>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Draws in from 12 o'clock with `expand` on first appearance. Reload the story to see it again. */
export const Default: Story = {
  render: (args) => (
    <SegmentedRing {...args}>
      <Text variant="title3" tabular>
        1 h 58 min
      </Text>
    </SegmentedRing>
  ),
};

export const Small: Story = {
  args: { size: 'small', diameter: 40 },
};

/** One category takes the whole day: the circle closes with no gap. */
export const Single: Story = {
  args: { segments: [{ id: 'development', value: 1, tint: 'purple' }] },
};

/** Nothing recorded yet: only the track. */
export const Empty: Story = {
  args: { segments: [] },
};

function ShiftingRing() {
  const [segments, setSegments] = useState(categories);
  const bump = (id: string, by: number) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === id ? { ...segment, value: Math.max(0, segment.value + by) } : segment,
      ),
    );
  };
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <SegmentedRing aria-label="Time by category" diameter={96} segments={segments}>
        <Text variant="title3" tabular>
          {segments.reduce((sum, segment) => sum + segment.value, 0)}
        </Text>
      </SegmentedRing>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            bump('browsing', 20);
          }}
        >
          <span className="muna-chip__label">Browsing +20</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            bump('development', -20);
          }}
        >
          <span className="muna-chip__label">Development −20</span>
        </Button>
      </div>
    </div>
  );
}

/** After the first draw, share changes follow with the `interactive` spring. */
export const Shifting: Story = {
  render: () => <ShiftingRing />,
};

/** Reduced motion: appears at its shares; changes use the 150 ms ease-out. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: () => <ShiftingRing />,
};
