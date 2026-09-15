import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from 'react-aria-components';
import { useState } from 'react';

import { Ring } from './ring';
import { Text } from './text';

const meta = {
  title: 'Primitives/Ring',
  component: Ring,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Move', diameter: 96, value: 62, tint: 'green' },
} satisfies Meta<typeof Ring>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Draws from 0 with `expand` on first appearance. Reload the story to see it again. */
export const Default: Story = {
  render: (args) => (
    <Ring {...args}>
      <Text variant="title3" tabular>
        {args.value}
      </Text>
    </Ring>
  ),
};

export const Small: Story = {
  args: { size: 'small', diameter: 40, value: 40, tint: 'blue', 'aria-label': 'Exercise' },
};

export const Empty: Story = {
  args: { value: 0, 'aria-label': 'Stand' },
};

export const Full: Story = {
  args: { value: 100, tint: 'purple', 'aria-label': 'Stand' },
};

/** Health widget: three rings with 10 px caps labels, the only all-caps text in Muna. */
export const HealthTrio: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
      {(
        [
          ['Move', 'green', 72],
          ['Exercise', 'blue', 45],
          ['Stand', 'purple', 90],
        ] as const
      ).map(([label, tint, value]) => (
        <div key={label} style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'center' }}>
          <Ring aria-label={label} diameter={64} size="small" tint={tint} value={value}>
            <Text variant="footnote" weight={600} tabular>
              {value}
            </Text>
          </Ring>
          <Text variant="caption2" tone="secondary" caps>
            {label}
          </Text>
        </div>
      ))}
    </div>
  ),
};

function SteppingRing() {
  const [value, setValue] = useState(30);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <Ring aria-label="Focus session" diameter={96} tint="orange" value={value}>
        <Text variant="title3" tabular>
          {value}
        </Text>
      </Ring>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setValue((v) => Math.max(0, v - 20));
          }}
        >
          <span className="muna-chip__label">−20</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setValue((v) => Math.min(100, v + 20));
          }}
        >
          <span className="muna-chip__label">+20</span>
        </Button>
      </div>
    </div>
  );
}

/** After the first draw, value changes follow with the `interactive` spring. */
export const Stepping: Story = {
  render: () => <SteppingRing />,
};

/** Reduced motion: appears at its value; changes use the 150 ms ease-out. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: () => <SteppingRing />,
};
