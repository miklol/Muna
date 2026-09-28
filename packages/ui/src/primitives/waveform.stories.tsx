import type { Meta, StoryObj } from '@storybook/react-vite';

import { Waveform } from './waveform';

const meta = {
  title: 'Primitives/Waveform',
  component: Waveform,
  parameters: { layout: 'centered', backgrounds: { value: 'notch' } },
  args: { playing: true },
} satisfies Meta<typeof Waveform>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Four bars sampled at 30 Hz, each following its target with the `interactive` spring. */
export const Playing: Story = {};

/** A paused waveform holds still at its resting skyline. */
export const Paused: Story = {
  args: { playing: false },
};

/** Reduced motion freezes the bars even while playing. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
};

/** In the strip: art beside the bars, both 20 px. */
export const InAStripSlot: Story = {
  render: (args) => (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        blockSize: 32,
        paddingInline: 'var(--space-2)',
        borderRadius: 'var(--radius-strip)',
        background: '#000',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          inlineSize: 20,
          blockSize: 20,
          borderRadius: 6,
          background: 'linear-gradient(135deg, #5ac8fa, #bf5af2)',
        }}
      />
      <span style={{ inlineSize: 120 }} />
      <Waveform {...args} />
    </div>
  ),
};
