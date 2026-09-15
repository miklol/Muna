import type { Meta, StoryObj } from '@storybook/react-vite';
import { motion } from 'motion/react';
import { type CSSProperties, type ReactNode, useState } from 'react';

import { CloseGlyph, MusicGlyph, PauseGlyph, SkipGlyph } from '../foundations/glyphs';
import { useMotionPreset } from '../motion/reduced-motion';
import { notchRadii } from '../shape/notch-path';
import { Hairline } from './hairline';
import { IconButton } from './icon-button';
import { NotchSurface } from './notch-surface';
import { ProgressTrack } from './progress-track';
import { Text } from './text';

/** Strip and panel body sizes from docs/05-design-system.md#spacing--sizing, plus the flares. */
const strip = { width: 200 + 2 * notchRadii.collapsed.topRadius, height: 32 };
const panel = { width: 420 + 2 * notchRadii.expanded.topRadius, height: 220 };

const meta = {
  title: 'Primitives/NotchSurface',
  component: NotchSurface,
  parameters: { layout: 'fullscreen' },
  globals: { backgrounds: { value: 'desktop' } },
  decorators: [
    // The top edge of a desktop: the notch hangs from it.
    (Story) => (
      <div style={{ display: 'flex', justifyContent: 'center', minBlockSize: 360 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotchSurface>;

export default meta;

type Story = StoryObj<typeof meta>;

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  blockSize: '100%',
  paddingInline: 'var(--space-2)',
};

function StripContent() {
  return (
    <div style={{ ...row, justifyContent: 'space-between' }}>
      <span
        aria-hidden="true"
        style={{
          inlineSize: 'var(--size-strip-slot)',
          blockSize: 'var(--size-strip-slot)',
          borderRadius: 'var(--radius-control)',
          background: 'var(--accent-cyan)',
        }}
      />
      <span
        aria-hidden="true"
        style={{
          inlineSize: 'var(--size-strip-slot)',
          blockSize: 'var(--size-strip-slot)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-cyan)',
        }}
      >
        <MusicGlyph />
      </span>
    </div>
  );
}

function PanelContent() {
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <IconButton aria-label="Media" isActive>
          <MusicGlyph />
        </IconButton>
        <Text variant="footnote" weight={600} tone="secondary">
          Now playing
        </Text>
        <span style={{ flex: 1 }} />
        <IconButton aria-label="Close">
          <CloseGlyph />
        </IconButton>
      </div>
      <Hairline />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span
          aria-hidden="true"
          style={{
            inlineSize: 64,
            blockSize: 64,
            borderRadius: 'var(--radius-tile)',
            background: 'var(--accent-cyan)',
            flex: 'none',
          }}
        />
        <div style={{ display: 'grid', gap: 'var(--space-1)', minInlineSize: 0, flex: 1 }}>
          <Text weight={600} truncate={1}>
            Nothing else matters
          </Text>
          <Text variant="footnote" tone="secondary" truncate={1}>
            Metallica — Metallica
          </Text>
        </div>
        <IconButton aria-label="Pause" size="large">
          <PauseGlyph />
        </IconButton>
        <IconButton aria-label="Next">
          <SkipGlyph />
        </IconButton>
      </div>
      <ProgressTrack aria-label="Playback" tint="cyan" seekable value={38} />
    </div>
  );
}

/** Collapsed strip: black, bottom radius 14, 6 px flares into the bezel, no border. */
export const Strip: Story = {
  args: { shape: 'notch', state: 'collapsed' },
  render: (args) => (
    <NotchSurface {...args} style={{ inlineSize: strip.width, blockSize: strip.height }}>
      <StripContent />
    </NotchSurface>
  ),
};

/** Expanded panel: gradient material, catch-light, hairline (no top edge), 19 px flares. */
export const Panel: Story = {
  args: { shape: 'notch', state: 'expanded' },
  render: (args) => (
    <NotchSurface {...args} style={{ inlineSize: panel.width, blockSize: panel.height }}>
      <PanelContent />
    </NotchSurface>
  ),
};

/** Island: floats below the edge with 32 px continuous corners and a hairline all round. */
export const Island: Story = {
  args: { shape: 'island', state: 'expanded' },
  decorators: [
    (Story) => (
      <div style={{ paddingBlockStart: 'var(--space-4)' }}>
        <Story />
      </div>
    ),
  ],
  render: (args) => (
    <NotchSurface {...args} style={{ inlineSize: 240, blockSize: 88 }}>
      <div style={{ ...row, paddingInline: 'var(--space-4)' }}>
        <Text weight={600}>Focus</Text>
        <span style={{ flex: 1 }} />
        <Text variant="title3" tabular>
          24:59
        </Text>
      </div>
    </NotchSurface>
  ),
};

function MorphDemo({ children }: { children?: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const expand = useMotionPreset('expand');
  const collapse = useMotionPreset('collapse');
  const target = expanded ? panel : strip;
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 'var(--space-4)' }}>
      {/* The shell is the one node whose real size springs (docs/06-motion-spec.md#strip--panel). */}
      <motion.div
        initial={false}
        animate={{ width: target.width, height: target.height }}
        transition={expanded ? expand : collapse}
        onAnimationStart={() => {
          setMorphing(true);
        }}
        onAnimationComplete={() => {
          setMorphing(false);
        }}
        style={{ width: strip.width, height: strip.height }}
      >
        <NotchSurface
          shape="notch"
          state={expanded ? 'expanded' : 'collapsed'}
          morphing={morphing}
          style={{ inlineSize: '100%', blockSize: '100%' }}
        >
          {expanded ? children : <StripContent />}
        </NotchSurface>
      </motion.div>
      <button
        type="button"
        className="muna-chip muna-chip--selectable"
        onClick={() => {
          setExpanded((v) => !v);
        }}
      >
        <span className="muna-chip__label">{expanded ? 'Collapse' : 'Expand'}</span>
      </button>
    </div>
  );
}

/**
 * The strip becomes the panel: `expand` / `collapse` spring the real size; masks drop while
 * morphing and the flared path returns at rest. Content swaps at the state change (M1-E1 adds
 * the choreography from the motion spec).
 */
export const Morph: Story = {
  args: { shape: 'notch', state: 'collapsed' },
  render: () => (
    <MorphDemo>
      <PanelContent />
    </MorphDemo>
  ),
};

/** Reduced motion: the size change runs in 150 ms ease-out, no overshoot. */
export const MorphReducedMotion: Story = {
  ...Morph,
  globals: { reduceMotion: 'on', backgrounds: { value: 'desktop' } },
};

/** Increased contrast: the strip gains a 1 px hairline so black stays visible on dark wallpaper. */
export const Contrast: Story = {
  args: { shape: 'notch', state: 'collapsed' },
  globals: { backgrounds: { value: 'notch' } },
  render: (args) => (
    <div data-contrast="more">
      <NotchSurface {...args} style={{ inlineSize: strip.width, blockSize: strip.height }}>
        <StripContent />
      </NotchSurface>
    </div>
  ),
};
