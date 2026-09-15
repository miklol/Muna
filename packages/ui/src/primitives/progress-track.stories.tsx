import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from 'react-aria-components';
import { useEffect, useState } from 'react';

import { ProgressTrack } from './progress-track';
import { Text } from './text';

const meta = {
  title: 'Primitives/ProgressTrack',
  component: ProgressTrack,
  parameters: { layout: 'padded' },
  args: { 'aria-label': 'Playback', value: 30 },
  decorators: [
    (Story) => (
      <div style={{ inlineSize: 280 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProgressTrack>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Hover the track to reveal the 12 px thumb riding the end of the fill. */
export const Seekable: Story = {
  args: { seekable: true, tint: 'cyan', value: 64 },
};

export const Tints: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <ProgressTrack aria-label="Accent" value={40} />
      <ProgressTrack aria-label="Media" tint="cyan" value={55} />
      <ProgressTrack aria-label="Pomodoro" tint="orange" value={70} />
      <ProgressTrack aria-label="Danger" tint="red" value={90} />
    </div>
  ),
};

function StepDemo({ tickMs }: { tickMs?: number }) {
  const [value, setValue] = useState(20);
  useEffect(() => {
    if (tickMs === undefined) return;
    const id = window.setInterval(() => {
      setValue((v) => (v >= 100 ? 0 : v + 1));
    }, tickMs);
    return () => {
      window.clearInterval(id);
    };
  }, [tickMs]);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <ProgressTrack aria-label="Playback" tint="cyan" seekable value={value} />
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setValue((v) => Math.max(0, v - 25));
          }}
        >
          <span className="muna-chip__label">−25</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setValue((v) => Math.min(100, v + 25));
          }}
        >
          <span className="muna-chip__label">+25</span>
        </Button>
        <Text variant="footnote" tone="secondary" tabular>
          {value} %
        </Text>
      </div>
    </div>
  );
}

/** Jumps follow with the `interactive` spring (transform only, no width animation). */
export const Seeking: Story = {
  render: () => <StepDemo />,
};

/** One tick per second, as a media position would. The interval stops when the story unmounts. */
export const Playing: Story = {
  render: () => <StepDemo tickMs={1000} />,
};

/** Reduced motion: the fill still moves, in 150 ms ease-out instead of the spring. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: () => <StepDemo />,
};

export const RTL: Story = {
  render: () => (
    <div dir="rtl" style={{ display: 'grid', gap: 'var(--space-3)' }}>
      <ProgressTrack aria-label="التشغيل" tint="cyan" seekable value={35} />
    </div>
  ),
};
