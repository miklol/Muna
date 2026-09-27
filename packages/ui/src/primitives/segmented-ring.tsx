import { type MotionStyle, motion } from 'motion/react';
import { type ComponentPropsWithoutRef, type ReactNode, useState } from 'react';

import { useMotionPreset, useReduceMotion } from '../motion/reduced-motion';
import './segmented-ring.css';
import { cx, type Tint, tintVar } from './shared';

/** Stroke widths from the sizing table: 8 px, 6 px for S widgets. */
const strokeWidth = { default: 8, small: 6 } as const;

/** The gap between two neighbouring segments, along the arc. */
const GAP_PX = 2;

/** A segment tint: one of the accent tints, or `neutral` (`--text-3`) for a rest bucket. */
export type SegmentTint = Tint | 'neutral';

export interface RingSegment {
  /** Stable key; a segment that keeps its id animates to its new share. */
  readonly id: string;
  /** Any non-negative quantity; shares are the values over their sum. */
  readonly value: number;
  readonly tint: SegmentTint;
}

export interface RingArc {
  readonly id: string;
  /** Where the arc starts, as a fraction of the circumference from 12 o'clock. */
  readonly start: number;
  /** How much of the circumference the arc covers, gaps taken out. */
  readonly length: number;
  readonly tint: SegmentTint;
}

/** The colour behind a segment tint, for `--muna-tint` on the arc. */
export const segmentColor = (tint: SegmentTint): string =>
  tint === 'neutral' ? 'var(--text-3)' : tintVar(tint);

/**
 * Lays the segments around the ring in order, clockwise from 12 o'clock. Zero and negative
 * values take no arc; a lone segment closes the circle without a gap. The gap is a fraction
 * of the circumference so it stays `GAP_PX` wide on any diameter, and a segment smaller than
 * its gap collapses to nothing rather than drawing a dot.
 */
export function ringArcs(
  segments: readonly RingSegment[],
  circumference: number,
  gapPx: number = GAP_PX,
): RingArc[] {
  const drawn = segments.filter((segment) => segment.value > 0);
  const total = drawn.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return [];
  const gap = drawn.length > 1 && circumference > 0 ? gapPx / circumference : 0;
  let cursor = 0;
  return drawn.map((segment) => {
    const share = segment.value / total;
    const arc: RingArc = {
      id: segment.id,
      start: cursor + gap / 2,
      length: Math.max(0, share - gap),
      tint: segment.tint,
    };
    cursor += share;
    return arc;
  });
}

export interface SegmentedRingProps extends Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'role'
> {
  /** Outer diameter in px (the composition picks the size; the ring does not guess). */
  diameter: number;
  /** Stroke 8 (`default`) or 6 (`small`). */
  size?: keyof typeof strokeWidth;
  /** The parts, in legend order; their values need not sum to anything in particular. */
  segments: readonly RingSegment[];
  /** Centre content — a total with `Text tabular`, or a label. */
  children?: ReactNode;
}

/**
 * A ring split into tinted arcs by share (docs/05-design-system.md#spacing--sizing), the
 * donut behind "time by category". Draws in from 12 o'clock with `expand` on first appearance,
 * then follows share changes with `interactive`; under reduced motion it appears at its shares.
 * Rendered as an image: pass `aria-label` with the spoken summary and keep the legend beside it.
 * With nothing to show, only the faint track remains.
 */
export function SegmentedRing({
  diameter,
  size = 'default',
  segments,
  className,
  style,
  children,
  ...rest
}: SegmentedRingProps) {
  const stroke = strokeWidth[size];
  const radius = Math.max(0, (diameter - stroke) / 2);
  const centre = diameter / 2;
  const arcs = ringArcs(segments, 2 * Math.PI * radius);

  const reduceMotion = useReduceMotion();
  const draw = useMotionPreset('expand');
  const follow = useMotionPreset('interactive');
  // First appearance draws in with `expand`; every later change follows with `interactive`.
  const [drawn, setDrawn] = useState(reduceMotion);

  return (
    <div
      role="img"
      {...rest}
      className={cx('muna-segmented-ring', className)}
      style={{ ...style, inlineSize: diameter, blockSize: diameter }}
      data-empty={arcs.length === 0 || undefined}
    >
      <svg
        aria-hidden="true"
        className="muna-segmented-ring__svg"
        viewBox={`0 0 ${diameter} ${diameter}`}
        width={diameter}
        height={diameter}
      >
        <circle
          className="muna-segmented-ring__track"
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
        />
        {arcs.map((arc) => (
          <motion.circle
            key={arc.id}
            className="muna-segmented-ring__segment"
            data-segment={arc.id}
            cx={centre}
            cy={centre}
            r={radius}
            strokeWidth={stroke}
            style={{ '--muna-tint': segmentColor(arc.tint) } as MotionStyle}
            initial={reduceMotion ? false : { pathLength: 0, pathOffset: 0 }}
            animate={{ pathLength: arc.length, pathOffset: arc.start }}
            transition={drawn ? follow : draw}
            onAnimationComplete={() => {
              setDrawn(true);
            }}
          />
        ))}
      </svg>
      {children !== undefined && <span className="muna-segmented-ring__content">{children}</span>}
    </div>
  );
}
