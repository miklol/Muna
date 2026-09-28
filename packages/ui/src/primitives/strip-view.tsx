import { AnimatePresence, motion, type Transition } from 'motion/react';
import type { CSSProperties, ReactNode } from 'react';

import { contentExitTransition, contentRecipe, glyphCrossfadeTransition } from '../motion/presets';
import { useMotionPreset, useReduceMotion } from '../motion/reduced-motion';
import { BatteryGlyph } from './battery-glyph';
import { LevelTrack } from './level-track';
import { Ring } from './ring';
import { cx, type Tint, tintStyle } from './shared';
import './strip-view.css';
import { Text } from './text';
import { TimerText } from './timer-text';
import { Waveform } from './waveform';

/**
 * What one 20 px slot of the strip shows. A UI-level vocabulary: the shell maps the
 * contract's `Leading`/`Trailing` to it (glyphs become icons, facts become text).
 */
export type StripSlotContent =
  | {
      kind: 'icon';
      icon: ReactNode;
      tint?: Tint;
      /**
       * Identity of the glyph. When it changes under the same item the old and new glyph
       * crossfade (the HUD's speaker waves); without it the icon swaps in place.
       */
      id?: string;
    }
  | {
      kind: 'image';
      src: string;
      /** A palette colour (CSS) that softly haloes the image at ≤ 30 %; album art sets it. */
      tint?: string | null;
    }
  | { kind: 'text'; value: string }
  | { kind: 'battery'; percent: number; charging: boolean }
  | {
      kind: 'timer';
      remainingMs: number;
      totalMs: number;
      running: boolean;
      /** `Date.now()` when the value arrived; the timer counts from here. */
      receivedAt: number;
    }
  | { kind: 'progress'; percent: number }
  /** Four audio bars; they move only while `playing`. */
  | { kind: 'waveform'; playing: boolean }
  /**
   * The HUD level (docs/modules/hud.md "Visual"): a 96 × 6 track that appears with `reveal`
   * and is draggable while it shows.
   */
  | {
      kind: 'level';
      percent: number;
      muted: boolean;
      /** Names the control for assistive technology ("Volume"). */
      label: string;
      /** Formatted value beside the track, or `null` to show the track alone. */
      valueText?: string | null | undefined;
      onChange?: ((percent: number) => void) | undefined;
      onChangeEnd?: ((percent: number) => void) | undefined;
    };

export interface StripViewProps {
  /** Names the region ("Notch strip"). */
  'aria-label': string;
  /** Stable id of what is showing; a change replays the arrival choreography. */
  itemId: string | null;
  kind: 'idle' | 'activity' | 'notice';
  leading?: StripSlotContent | null;
  trailing?: StripSlotContent | null;
  /** One line for the wide form, already localised. Shown only while `wide`. */
  text?: string | null;
  /** Whether the strip is in its wide form; the shell morphs the width to match. */
  wide?: boolean;
  /**
   * What assistive technology reads for the current content (the text, or a description of
   * the slots when there is none). Announced through a polite live region.
   */
  description: string;
  className?: string;
}

/** Slot content slides out from behind the black centre: this far, toward the centre. */
export const stripSlotOffsetPx = 24;

/** The strip's slot measurements (docs/05-design-system.md "Per-surface notes"). */
export const stripSlotLayout = { size: 20, inset: 10 } as const;

const slotKey = (content: StripSlotContent | null | undefined): string => {
  if (content === null || content === undefined) return 'empty';
  switch (content.kind) {
    case 'icon':
      return `icon:${content.tint ?? 'plain'}`;
    case 'image':
      return `image:${content.src}`;
    case 'text':
      return 'text';
    case 'battery':
      return 'battery';
    case 'timer':
      return 'timer';
    case 'progress':
      return 'progress';
    case 'waveform':
      return 'waveform';
    case 'level':
      return 'level';
  }
};

/** Inline style for a haloed image: the palette colour as `--muna-art-tint`. */
const artTintStyle = (tint: string): CSSProperties =>
  ({ '--muna-art-tint': tint }) as CSSProperties;

interface IconProps {
  icon: ReactNode;
  tint: Tint | undefined;
}

function Icon({ icon, tint }: IconProps) {
  return (
    <span
      className={cx('muna-strip__icon', tint !== undefined && 'muna-strip__icon--tinted')}
      style={tint === undefined ? undefined : tintStyle(tint)}
    >
      {icon}
    </span>
  );
}

function SlotContent({ content }: { content: StripSlotContent }) {
  switch (content.kind) {
    case 'icon':
      if (content.id === undefined) {
        return <Icon icon={content.icon} tint={content.tint} />;
      }
      // A glyph with identity: swaps crossfade (docs/06-motion-spec.md "HUD", 100 ms) and
      // nothing moves, so a run of key presses reads as one glyph updating.
      return (
        <span className="muna-strip__glyph">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={content.id}
              className="muna-strip__glyph-frame"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: glyphCrossfadeTransition }}
              exit={{ opacity: 0, transition: glyphCrossfadeTransition }}
            >
              <Icon icon={content.icon} tint={content.tint} />
            </motion.span>
          </AnimatePresence>
        </span>
      );
    case 'image': {
      const tint = content.tint ?? null;
      return (
        <img
          className={cx('muna-strip__image', tint !== null && 'muna-strip__image--tinted')}
          style={tint === null ? undefined : artTintStyle(tint)}
          src={content.src}
          alt=""
          draggable={false}
        />
      );
    }
    case 'text':
      return (
        <Text variant="footnote" weight={600} tabular className="muna-strip__text">
          {content.value}
        </Text>
      );
    case 'battery':
      return <BatteryGlyph percent={content.percent} charging={content.charging} />;
    case 'timer':
      return (
        <TimerText
          className="muna-strip__text"
          remainingMs={content.remainingMs}
          running={content.running}
          receivedAt={content.receivedAt}
        />
      );
    case 'progress':
      return (
        <Ring
          aria-hidden="true"
          diameter={stripSlotLayout.size}
          size="small"
          value={content.percent}
          className="muna-strip__ring"
        />
      );
    case 'waveform':
      return <Waveform playing={content.playing} size={stripSlotLayout.size} />;
    case 'level':
      return (
        <LevelTrack
          aria-label={content.label}
          percent={content.percent}
          muted={content.muted}
          valueText={content.valueText ?? null}
          onChange={content.onChange}
          onChangeEnd={content.onChangeEnd}
          className="muna-strip__level"
        />
      );
  }
}

interface SlotProps {
  side: 'leading' | 'trailing';
  content: StripSlotContent | null | undefined;
  itemId: string | null;
  enter: Transition;
  /** What the HUD level track appears with (`reveal`, docs/06-motion-spec.md "HUD"). */
  reveal: Transition;
  exit: Transition;
  reduceMotion: boolean;
}

/**
 * One slot. Content enters by sliding from the strip's centre (`notice`, with its overshoot:
 * something arrived) and leaves the same way (`collapse`, no bounce), masked by the slot box.
 * The HUD level is the exception: it appears with `reveal` — a control coming up, not news.
 */
function Slot({ side, content, itemId, enter, reveal, exit, reduceMotion }: SlotProps) {
  // Toward the centre: the leading slot's content starts to its right, the trailing to its left.
  const offset = side === 'leading' ? stripSlotOffsetPx : -stripSlotOffsetPx;
  const hidden = reduceMotion ? { opacity: 0, x: 0 } : { opacity: 0, x: offset };
  const arrive = content?.kind === 'level' ? reveal : enter;
  return (
    <span className="muna-strip__slot" data-slot={side}>
      <AnimatePresence mode="popLayout" initial={false}>
        {content !== null && content !== undefined && (
          <motion.span
            key={`${itemId ?? ''}:${slotKey(content)}`}
            className="muna-strip__slot-content"
            initial={hidden}
            animate={{ opacity: 1, x: 0, transition: arrive }}
            exit={{ ...hidden, transition: exit }}
          >
            <SlotContent content={content} />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/**
 * The closed strip (docs/05-design-system.md "Per-surface notes", docs/06-motion-spec.md "Live
 * activity (notice)"): two 20 px slots inset 10 px from each edge around the black centre, or
 * the wide form with one line of footnote text between them. Purely presentational — the shell
 * decides what to show and morphs the surface's width; this component choreographs the content.
 */
export function StripView({
  'aria-label': label,
  itemId,
  kind,
  leading,
  trailing,
  text,
  wide = false,
  description,
  className,
}: StripViewProps) {
  const reduceMotion = useReduceMotion();
  const arrive = useMotionPreset('notice');
  const reveal = useMotionPreset('reveal');
  const leave = useMotionPreset('collapse');
  const contentEnter = useMotionPreset('content');
  const showText = wide && text !== null && text !== undefined && text !== '';
  return (
    <div
      role="region"
      aria-label={label}
      className={cx('muna-strip', className)}
      data-kind={kind}
      data-wide={showText || undefined}
    >
      <Slot
        side="leading"
        content={leading}
        itemId={itemId}
        enter={arrive}
        reveal={reveal}
        exit={leave}
        reduceMotion={reduceMotion}
      />
      <span className="muna-strip__centre">
        <AnimatePresence mode="popLayout" initial={false}>
          {showText && (
            <motion.span
              key={`${itemId ?? ''}:${text}`}
              className="muna-strip__wide"
              initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFrom}
              animate={{
                ...(reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible),
                transition: contentEnter,
              }}
              exit={{
                ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
                transition: contentExitTransition,
              }}
            >
              <Text as="span" variant="footnote" weight={600} truncate={1} aria-hidden="true">
                {text}
              </Text>
            </motion.span>
          )}
        </AnimatePresence>
        <span role="status" className="muna-strip__description">
          {description}
        </span>
      </span>
      <Slot
        side="trailing"
        content={trailing}
        itemId={itemId}
        enter={arrive}
        reveal={reveal}
        exit={leave}
        reduceMotion={reduceMotion}
      />
    </div>
  );
}
