import type { Meta, StoryObj } from '@storybook/react-vite';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';

import { BellGlyph, MusicGlyph, TimerGlyph } from '../foundations/glyphs';
import { timings } from '../motion/presets';
import { useMotionPreset } from '../motion/reduced-motion';
import { notchRadii } from '../shape/notch-path';
import { NotchSurface } from './notch-surface';
import { StripView, type StripViewProps } from './strip-view';
import { Text } from './text';

/** Strip sizes from docs/05-design-system.md#spacing--sizing, plus the flares. */
const flares = 2 * notchRadii.collapsed.topRadius;
const stripWidth = 200 + flares;
const wideWidth = 420 + flares;
const stripHeight = 32;

const meta = {
  title: 'Primitives/StripView',
  component: StripView,
  parameters: { layout: 'fullscreen' },
  globals: { backgrounds: { value: 'desktop' } },
  args: { 'aria-label': 'Notch strip' },
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'center', minBlockSize: 160 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StripView>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A strip-sized surface whose width springs between the compact and wide forms. */
function Frame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  const expand = useMotionPreset('expand');
  const collapse = useMotionPreset('collapse');
  return (
    <motion.div
      initial={false}
      animate={{ width: wide ? wideWidth : stripWidth }}
      transition={wide ? expand : collapse}
      style={{ blockSize: stripHeight }}
    >
      <NotchSurface
        shape="notch"
        state="collapsed"
        style={{ inlineSize: '100%', blockSize: '100%' }}
      >
        {children}
      </NotchSurface>
    </motion.div>
  );
}

const framed = (args: StripViewProps) => (
  <Frame wide={args.wide ?? false}>
    <StripView {...args} />
  </Frame>
);

/** Nothing to show: the bare black shape, described for assistive technology only. */
export const Idle: Story = {
  args: { itemId: null, kind: 'idle', description: 'Muna is running.' },
  render: framed,
};

/** Plugging in: battery glyph fills green with a bolt, percentage in the trailing slot. */
export const Charging: Story = {
  args: {
    itemId: 'power:charging',
    kind: 'notice',
    leading: { kind: 'battery', percent: 57, charging: true },
    trailing: { kind: 'text', value: '57%' },
    description: 'Charging, 57%',
  },
  render: framed,
};

/** Low battery: the wide form carries the warning, the glyph goes orange. */
export const BatteryLow: Story = {
  args: {
    itemId: 'power:low:20',
    kind: 'notice',
    leading: { kind: 'battery', percent: 20, charging: false },
    trailing: { kind: 'text', value: '20%' },
    text: 'Low battery',
    wide: true,
    description: 'Low battery, 20%',
  },
  render: framed,
};

/** Bluetooth connect: device glyph, name in the wide form, battery pill trailing. */
export const BluetoothConnected: Story = {
  args: {
    itemId: 'bluetooth:buds',
    kind: 'notice',
    leading: { kind: 'icon', icon: <BellGlyph />, tint: 'blue' },
    trailing: { kind: 'battery', percent: 80, charging: false },
    text: 'Galaxy Buds connected',
    wide: true,
    description: 'Galaxy Buds connected, battery 80%',
  },
  render: framed,
};

/** A running Pomodoro: tinted glyph and a countdown that ticks locally. */
export const Timer: Story = {
  args: {
    itemId: 'pomodoro:timer',
    kind: 'activity',
    leading: { kind: 'icon', icon: <TimerGlyph />, tint: 'orange' },
    trailing: {
      kind: 'timer',
      remainingMs: 24 * 60_000 + 59_000,
      totalMs: 25 * 60_000,
      running: true,
      receivedAt: Date.now(),
    },
    description: 'Focus, 24:59 left',
  },
  render: framed,
};

/** Media: album art leading, a small progress ring trailing. */
export const NowPlaying: Story = {
  args: {
    itemId: 'media:now-playing',
    kind: 'activity',
    leading: {
      kind: 'image',
      src: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><rect width="20" height="20" fill="%2364d2ff"/><circle cx="10" cy="10" r="5" fill="%23000"/></svg>',
    },
    trailing: { kind: 'progress', percent: 38 },
    description: 'Playing Nothing else matters by Metallica',
  },
  render: framed,
};

const idle: StripViewProps = {
  'aria-label': 'Notch strip',
  itemId: null,
  kind: 'idle',
  description: 'Muna is running.',
};

const sequence: readonly StripViewProps[] = [
  idle,
  {
    'aria-label': 'Notch strip',
    itemId: 'power:charging',
    kind: 'notice',
    leading: { kind: 'battery', percent: 57, charging: true },
    trailing: { kind: 'text', value: '57%' },
    description: 'Charging, 57%',
  },
  {
    'aria-label': 'Notch strip',
    itemId: 'bluetooth:buds',
    kind: 'notice',
    leading: { kind: 'icon', icon: <BellGlyph />, tint: 'blue' },
    trailing: { kind: 'battery', percent: 80, charging: false },
    text: 'Galaxy Buds connected',
    wide: true,
    description: 'Galaxy Buds connected, battery 80%',
  },
  {
    'aria-label': 'Notch strip',
    itemId: 'media:now-playing',
    kind: 'activity',
    leading: { kind: 'icon', icon: <MusicGlyph />, tint: 'cyan' },
    trailing: { kind: 'progress', percent: 38 },
    text: 'Nothing else matters — Metallica',
    wide: true,
    description: 'Playing Nothing else matters by Metallica',
  },
  {
    'aria-label': 'Notch strip',
    itemId: 'media:now-playing',
    kind: 'activity',
    leading: { kind: 'icon', icon: <MusicGlyph />, tint: 'cyan' },
    trailing: { kind: 'progress', percent: 38 },
    text: 'Nothing else matters — Metallica',
    wide: false,
    description: 'Playing Nothing else matters by Metallica',
  },
];

function Choreography({ auto }: { auto: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!auto) return;
    const id = window.setInterval(() => {
      setStep((value) => (value + 1) % sequence.length);
    }, timings.wideFormHoldMs);
    return () => {
      window.clearInterval(id);
    };
  }, [auto]);
  const current = sequence[step] ?? idle;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center' }}>
      <Frame wide={current.wide ?? false}>
        <StripView {...current} />
      </Frame>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setStep((value) => (value + 1) % sequence.length);
          }}
        >
          <span className="muna-chip__label">Next</span>
        </Button>
        <Text variant="footnote" tone="secondary">
          {current.itemId ?? 'idle'}
          {current.wide ? ' · wide' : ''}
        </Text>
      </div>
    </div>
  );
}

/**
 * Arrivals emerge from behind the centre with `notice` (a little overshoot: something
 * arrived); departures slide back with `collapse`. Press Next to step through idle → charging
 * → Bluetooth (wide) → media (wide) → media settled.
 */
export const Arrivals: Story = {
  args: { itemId: null, kind: 'idle', description: 'Muna is running.' },
  render: () => <Choreography auto={false} />,
};

/** The same sequence advancing every 2.5 s (`timings.wideFormHoldMs`). */
export const Cycling: Story = {
  args: { itemId: null, kind: 'idle', description: 'Muna is running.' },
  render: () => <Choreography auto />,
};

/** Reduced motion: content crossfades in place, no slide and no overshoot. */
export const ReducedMotion: Story = {
  globals: { reduceMotion: 'on' },
  args: { itemId: null, kind: 'idle', description: 'Muna is running.' },
  render: () => <Choreography auto={false} />,
};
