import { motion } from 'motion/react';
import { type ComponentPropsWithoutRef, type ReactNode, useState } from 'react';

import { useMotionPreset, useReduceMotion } from '../motion/reduced-motion';
import './ring.css';
import { cx, type Tint, tintStyle } from './shared';

/** Stroke widths from the sizing table: 8 px, 6 px for S widgets. */
const strokeWidth = { default: 8, small: 6 } as const;

export interface RingProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'role'> {
  /** Outer diameter in px (widgets pick the size; the ring does not guess). */
  diameter: number;
  /** Stroke 8 (`default`) or 6 (`small`). */
  size?: keyof typeof strokeWidth;
  tint?: Tint;
  value?: number;
  minValue?: number;
  maxValue?: number;
  /** Spoken value; defaults to the rounded percentage. */
  valueText?: string;
  /** Centre content — a value with `Text tabular`, or a label. */
  children?: ReactNode;
}

/**
 * Activity-style ring (docs/05-design-system.md#spacing--sizing). Draws from 0 with `expand`
 * on first appearance, then follows value changes with `interactive`; under reduced motion it
 * appears at its value. Rings carry labels: pass `aria-label` and show the value inside.
 *
 * Renders `role="meter"` itself rather than React Aria's `Meter`, whose fallback
 * `role="meter progressbar"` axe-core (4.13) rejects; every engine Muna targets knows `meter`.
 */
export function Ring({
  diameter,
  size = 'default',
  tint = 'accent',
  className,
  style,
  children,
  value = 0,
  minValue = 0,
  maxValue = 100,
  valueText,
  ...rest
}: RingProps) {
  const stroke = strokeWidth[size];
  const radius = Math.max(0, (diameter - stroke) / 2);
  const centre = diameter / 2;
  const span = maxValue - minValue;
  const fraction = span > 0 ? Math.min(1, Math.max(0, (value - minValue) / span)) : 0;

  const reduceMotion = useReduceMotion();
  const draw = useMotionPreset('expand');
  const follow = useMotionPreset('interactive');
  // First appearance draws in with `expand`; every later change follows with `interactive`.
  const [drawn, setDrawn] = useState(reduceMotion);

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={minValue}
      aria-valuemax={maxValue}
      aria-valuetext={valueText ?? `${Math.round(fraction * 100)}%`}
      {...rest}
      className={cx('muna-ring', className)}
      style={tintStyle(tint, { ...style, inlineSize: diameter, blockSize: diameter })}
    >
      <svg
        aria-hidden="true"
        className="muna-ring__svg"
        viewBox={`0 0 ${diameter} ${diameter}`}
        width={diameter}
        height={diameter}
      >
        <circle
          className="muna-ring__track"
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
        />
        <motion.circle
          className="muna-ring__value"
          cx={centre}
          cy={centre}
          r={radius}
          strokeWidth={stroke}
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: fraction }}
          transition={drawn ? follow : draw}
          onAnimationComplete={() => {
            setDrawn(true);
          }}
        />
      </svg>
      {children !== undefined && <span className="muna-ring__content">{children}</span>}
    </div>
  );
}
