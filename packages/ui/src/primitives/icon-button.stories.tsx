import type { Meta, StoryObj } from '@storybook/react-vite';

import {
  CloseGlyph,
  MusicGlyph,
  PauseGlyph,
  PlayGlyph,
  SkipGlyph,
  TimerGlyph,
} from '../foundations/glyphs';
import { IconButton } from './icon-button';
import { Text } from './text';

const meta = {
  title: 'Primitives/IconButton',
  component: IconButton,
  parameters: { layout: 'centered' },
  args: { 'aria-label': 'Play', children: <PlayGlyph /> },
} satisfies Meta<typeof IconButton>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Hover, press and focus the button in the canvas: tint-only hover, 0.96 press, 2 px ring. */
export const Default: Story = {};

export const Large: Story = {
  args: { size: 'large', 'aria-label': 'Pause', children: <PauseGlyph /> },
};

export const Active: Story = {
  args: { isActive: true, 'aria-label': 'Media', children: <MusicGlyph /> },
};

export const Disabled: Story = {
  args: { isDisabled: true, 'aria-label': 'Skip', children: <SkipGlyph /> },
};

/** A panel header rail: 28 px circles at 8 px gaps, one active. */
export const Rail: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <IconButton aria-label="Media" isActive>
        <MusicGlyph />
      </IconButton>
      <IconButton aria-label="Focus timer">
        <TimerGlyph />
      </IconButton>
      <IconButton aria-label="Close">
        <CloseGlyph />
      </IconButton>
    </div>
  ),
};

/** Reduced motion: hover and press change colour but no longer scale. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: (args) => (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <IconButton {...args} />
      <Text variant="footnote" tone="secondary">
        Press: colour only, no scale
      </Text>
    </div>
  ),
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
      <IconButton aria-label="السابق">
        <SkipGlyph />
      </IconButton>
      <IconButton aria-label="تشغيل" size="large">
        <PlayGlyph />
      </IconButton>
    </div>
  ),
};
