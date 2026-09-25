import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { LevelTrack } from './level-track';

function Controlled(props: { initial?: number; muted?: boolean; showValue?: boolean }) {
  const [percent, setPercent] = useState(props.initial ?? 45);
  const [muted, setMuted] = useState(props.muted ?? false);
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', justifyItems: 'center' }}>
      <LevelTrack
        aria-label="Volume"
        percent={percent}
        muted={muted}
        valueText={props.showValue === true ? `${String(Math.round(percent))}%` : null}
        onChange={(value) => {
          setPercent(value);
          if (muted && value > percent) setMuted(false);
        }}
      />
      <button
        type="button"
        onClick={() => {
          setMuted((current) => !current);
        }}
      >
        {muted ? 'Unmute' : 'Mute'}
      </button>
    </div>
  );
}

const meta = {
  title: 'Primitives/LevelTrack',
  component: LevelTrack,
  parameters: { layout: 'centered', backgrounds: { value: 'notch' } },
  args: { 'aria-label': 'Volume', percent: 45 },
  render: () => <Controlled />,
} satisfies Meta<typeof LevelTrack>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The HUD level: 96 × 6 white track. Drag it; the fill follows with `interactive`. */
export const Default: Story = {};

/** *Show level text*: the caption value beside the track. */
export const WithValue: Story = {
  render: () => <Controlled showValue />,
};

/** Muted: the fill drains with `collapse`; the value stays so unmuting refills to it. */
export const Muted: Story = {
  render: () => <Controlled muted showValue />,
};

export const Empty: Story = {
  render: () => <Controlled initial={0} showValue />,
};

export const Full: Story = {
  render: () => <Controlled initial={100} showValue />,
};

/** Reduced motion: the fill snaps to each new value and the drain is a fade. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  render: () => <Controlled showValue />,
};

/** In RTL the fill grows from the right and the value sits on the left. */
export const RTL: Story = {
  render: () => (
    <div dir="rtl">
      <Controlled initial={30} showValue />
    </div>
  ),
};
