import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Checkbox } from './checkbox';
import { Text } from './text';

const meta = {
  title: 'Primitives/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
  args: { children: 'Water the plants' },
} satisfies Meta<typeof Checkbox>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 20 px circle: a 1.5 px `--hairline-strong` ring off, the accent with an `--on-accent` check on. */
export const Default: Story = {};

export const Checked: Story = {
  args: { defaultSelected: true },
};

/** Without a visible label, pass `aria-label` (task rows name the task). */
export const Unlabelled: Story = {
  args: { children: undefined, 'aria-label': 'Complete Water the plants' },
};

/** The check draws in with the `toggle` spring; click to watch it. */
export const Interactive: Story = {
  render: (args) => {
    const [selected, setSelected] = useState(false);
    return (
      <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'start' }}>
        <Checkbox {...args} isSelected={selected} onChange={setSelected} />
        <Text variant="footnote" tone="secondary">
          {selected ? 'Done' : 'Open'}
        </Text>
      </div>
    );
  },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Checkbox isDisabled>Off and disabled</Checkbox>
      <Checkbox isDisabled defaultSelected>
        On and disabled
      </Checkbox>
    </div>
  ),
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 220 }}>
      <Checkbox>Book the dentist and ask about the appointment in the spring</Checkbox>
    </div>
  ),
};

/** Reduced motion: the check appears and the fill switches instantly. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'start' }}>
      <Checkbox {...args} />
      <Text variant="footnote" tone="secondary">
        Check: instant, no draw
      </Text>
    </div>
  ),
};

/** In RTL the box sits on the right of the label. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Checkbox>سقي النباتات</Checkbox>
      <Checkbox defaultSelected>شراء الحليب</Checkbox>
    </div>
  ),
};
