import type { Meta, StoryObj } from '@storybook/react-vite';

import { Text } from './text';
import { Toggle } from './toggle';

const meta = {
  title: 'Primitives/Toggle',
  component: Toggle,
  parameters: { layout: 'centered' },
  args: { children: 'Show notifications' },
} satisfies Meta<typeof Toggle>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 36 × 20 track, 16 px knob; off is `--surface-3`, on is the accent with an `--on-accent` knob. */
export const Default: Story = {};

export const On: Story = {
  args: { defaultSelected: true },
};

/** Without a visible label, pass `aria-label`. */
export const Unlabelled: Story = {
  args: { children: undefined, 'aria-label': 'Show notifications', defaultSelected: true },
};

export const Disabled: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Toggle isDisabled>Off and disabled</Toggle>
      <Toggle isDisabled defaultSelected>
        On and disabled
      </Toggle>
    </div>
  ),
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 220 }}>
      <Toggle>Keep the panel open after a track change until the pointer leaves</Toggle>
    </div>
  ),
};

/** Reduced motion: the knob and track colour switch instantly. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'start' }}>
      <Toggle {...args} />
      <Text variant="footnote" tone="secondary">
        Switch: instant, no glide
      </Text>
    </div>
  ),
};

/** In RTL the knob rests on the right and travels left when on. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <Toggle>إظهار الإشعارات</Toggle>
      <Toggle defaultSelected>الوضع الداكن</Toggle>
    </div>
  ),
};
