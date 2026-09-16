import type { Meta, StoryObj } from '@storybook/react-vite';

import { PlayGlyph } from '../foundations/glyphs';
import { Button } from './button';
import { Text } from './text';

const meta = {
  title: 'Primitives/Button',
  component: Button,
  parameters: { layout: 'centered' },
  args: { children: 'Connect' },
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Secondary by default: `--surface-2`, hover `--surface-3`, press 0.96 with `press`. */
export const Default: Story = {};

/** Accent fill with `--on-accent` text (white on the accent blue fails 4.5:1). */
export const Primary: Story = {
  args: { variant: 'primary', children: 'Save' },
};

export const Destructive: Story = {
  args: { variant: 'destructive', children: 'Remove' },
};

export const WithIcon: Story = {
  args: { icon: <PlayGlyph />, children: 'Play' },
};

export const Disabled: Story = {
  args: { isDisabled: true, children: 'Connect' },
};

export const LongContent: Story = {
  render: () => (
    <div style={{ inlineSize: 160, display: 'flex' }}>
      <Button>Snooze this notification for ten minutes</Button>
    </div>
  ),
};

export const Variants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <Button variant="primary">Save</Button>
      <Button>Cancel</Button>
      <Button variant="destructive">Remove</Button>
    </div>
  ),
};

/** Reduced motion: hover and press change colour but no longer scale. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <Button {...args} />
      <Text variant="footnote" tone="secondary">
        Press: colour only, no scale
      </Text>
    </div>
  ),
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'flex', gap: 'var(--space-2)' }}>
      <Button variant="primary" icon={<PlayGlyph />}>
        تشغيل
      </Button>
      <Button>إلغاء</Button>
    </div>
  ),
};
