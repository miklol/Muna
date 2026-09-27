import type { Meta, StoryObj } from '@storybook/react-vite';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useState } from 'react';
import { Button } from 'react-aria-components';

import {
  BellGlyph,
  MusicGlyph,
  SunGlyph,
  TerminalGlyph,
  TimerGlyph,
  VolumeGlyph,
  VolumeMutedGlyph,
} from '../foundations/glyphs';
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

const volumeWaves = (percent: number): 0 | 1 | 2 | 3 =>
  percent === 0 ? 0 : percent <= 33 ? 1 : percent <= 66 ? 2 : 3;

/** The HUD in the strip: speaker glyph leading, the draggable level track trailing. */
function Hud({ showValue }: { showValue: boolean }) {
  const [percent, setPercent] = useState(45);
  const [muted, setMuted] = useState(false);
  const glyphId = muted ? 'volumeMuted' : `volume${String(volumeWaves(percent))}`;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center' }}>
      <Frame>
        <StripView
          aria-label="Notch strip"
          itemId="hud:volume"
          kind="notice"
          leading={{
            kind: 'icon',
            id: glyphId,
            icon: muted ? <VolumeMutedGlyph /> : <VolumeGlyph waves={volumeWaves(percent)} />,
          }}
          trailing={{
            kind: 'level',
            percent,
            muted,
            label: 'Volume',
            valueText: showValue ? `${String(Math.round(percent))}%` : null,
            onChange: (value) => {
              setPercent(value);
              if (muted && value > percent) setMuted(false);
            },
          }}
          description={`${muted ? 'Muted' : 'Volume'}, ${String(Math.round(percent))}%`}
        />
      </Frame>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setPercent((value) => Math.max(0, value - 10));
          }}
        >
          <span className="muna-chip__label">−10</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setPercent((value) => Math.min(100, value + 10));
          }}
        >
          <span className="muna-chip__label">+10</span>
        </Button>
        <Button
          className="muna-chip muna-chip--selectable"
          onPress={() => {
            setMuted((value) => !value);
          }}
        >
          <span className="muna-chip__label">{muted ? 'Unmute' : 'Mute'}</span>
        </Button>
      </div>
    </div>
  );
}

/**
 * HUD (docs/06-motion-spec.md "HUD"): the track appears with `reveal`, the fill follows with
 * `interactive`, the glyph crossfades as the waves change and a mute drains the fill with
 * `collapse`. Drag the track; press the chips for key-sized steps.
 */
export const VolumeHud: Story = {
  args: { itemId: 'hud:volume', kind: 'notice', description: 'Volume, 45%' },
  render: () => <Hud showValue={false} />,
};

/** *Show level text* on: the percentage beside the track. */
export const VolumeHudWithValue: Story = {
  args: { itemId: 'hud:volume', kind: 'notice', description: 'Volume, 45%' },
  render: () => <Hud showValue />,
};

/** Brightness: the sun glyph and the same track. */
export const BrightnessHud: Story = {
  args: {
    itemId: 'hud:brightness',
    kind: 'notice',
    leading: { kind: 'icon', icon: <SunGlyph />, id: 'sun' },
    trailing: { kind: 'level', percent: 70, muted: false, label: 'Brightness' },
    description: 'Brightness, 70%',
  },
  render: framed,
};

/** A coding agent asks permission: the terminal glyph, the sentence, Allow / Deny on the right. */
function AgentWaitingStrip() {
  const [answer, setAnswer] = useState<'allow' | 'deny' | null>(null);
  const answered = answer !== null;
  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center' }}>
      <Frame wide={!answered}>
        <StripView
          aria-label="Notch strip"
          itemId={answered ? null : 'ai-coding:waiting:claude:s1'}
          kind={answered ? 'idle' : 'activity'}
          leading={
            answered
              ? null
              : { kind: 'icon', icon: <TerminalGlyph />, tint: 'orange', id: 'terminal' }
          }
          trailing={
            answered
              ? null
              : {
                  kind: 'decision',
                  label: 'Allow or deny',
                  allowLabel: 'Allow',
                  denyLabel: 'Deny',
                  onAllow: () => {
                    setAnswer('allow');
                  },
                  onDeny: () => {
                    setAnswer('deny');
                  },
                }
          }
          text={answered ? null : 'Claude Code wants to run Bash'}
          wide={!answered}
          description={
            answered ? 'Muna is running.' : 'Claude Code wants to run Bash, allow or deny'
          }
        />
      </Frame>
      <Text as="p" variant="caption" tone="secondary">
        {answer === null ? 'Press Allow or Deny.' : `Answered: ${answer}.`}
      </Text>
    </div>
  );
}

/**
 * AI coding (docs/modules/ai-coding.md): the wide form with the decision pair trailing. The
 * pills appear with `reveal`; an answer collapses the strip.
 */
export const AgentWaiting: Story = {
  args: { itemId: 'ai-coding:waiting:claude:s1', kind: 'activity', description: '' },
  render: () => <AgentWaitingStrip />,
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
