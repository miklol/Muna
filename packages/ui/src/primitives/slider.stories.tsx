import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Slider } from './slider';
import { Text } from './text';

function Controlled(props: {
  initial?: number;
  tint?: 'accent' | 'orange' | 'green';
  isDisabled?: boolean;
}) {
  const [value, setValue] = useState(props.initial ?? 40);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'center' }}>
      <Slider
        aria-label="Volume"
        value={value}
        onChange={setValue}
        tint={props.tint ?? 'accent'}
        isDisabled={props.isDisabled === true}
      />
      <Text variant="footnote" tone="secondary" tabular>
        {Math.round(value)}%
      </Text>
    </div>
  );
}

const meta = {
  title: 'Primitives/Slider',
  component: Slider,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Volume' },
  render: () => <Controlled />,
} satisfies Meta<typeof Slider>;

export default meta;

type Story = StoryObj<typeof meta>;

/** HUD slider: 96 × 6 track with a 12 px knob; the fill follows the value with `interactive`. */
export const Default: Story = {};

export const Empty: Story = {
  render: () => <Controlled initial={0} />,
};

export const Full: Story = {
  render: () => <Controlled initial={100} />,
};

export const Tinted: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Controlled tint="accent" initial={40} />
      <Controlled tint="orange" initial={65} />
      <Controlled tint="green" initial={90} />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => <Controlled isDisabled />,
};

/** Reduced motion: the fill snaps to each new value. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** In RTL the fill grows from the right. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <Controlled initial={30} />
    </div>
  ),
};
