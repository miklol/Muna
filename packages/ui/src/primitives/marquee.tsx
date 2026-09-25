import { motion } from 'motion/react';
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';

import { timings } from '../motion/presets';
import { useReduceMotion } from '../motion/reduced-motion';
import { cx } from './shared';
import './marquee.css';

export interface MarqueeProps {
  /** The text (or inline content) to scroll when it overflows. */
  children: ReactNode;
  /** Distance between the end of the text and its repeated copy, px. */
  gap?: number;
  /** Measures overflow; tests inject widths because jsdom has no layout. */
  measure?: (element: HTMLElement) => { container: number; content: number };
  className?: string;
}

/** Overflow measurement from the DOM (`scrollWidth` beats `clientWidth` when the text clips). */
export const measureOverflow = (element: HTMLElement): { container: number; content: number } => {
  const content = element.firstElementChild;
  return {
    container: element.clientWidth,
    content: content instanceof HTMLElement ? content.scrollWidth : 0,
  };
};

/** Whether text of `content` px overflows a `container` px box; equal widths do not scroll. */
export const overflows = (container: number, content: number): boolean =>
  content > container && container > 0;

/**
 * One loop's keyframe timings (docs/06-motion-spec.md "Marquee"): wait, scroll one copy plus
 * the gap at 40 px/s, pause, jump back. Returned as Motion `times` fractions and a duration.
 */
export const marqueeTimeline = (
  distancePx: number,
): { durationS: number; times: [number, number, number, number] } => {
  const startS = timings.marqueeStartDelayMs / 1000;
  const scrollS = distancePx / timings.marqueeSpeedPxPerS;
  const pauseS = timings.marqueeEndPauseMs / 1000;
  const durationS = startS + scrollS + pauseS;
  return {
    durationS,
    times: [0, startS / durationS, (startS + scrollS) / durationS, 1],
  };
};

/**
 * Text that scrolls only when it does not fit (docs/06-motion-spec.md "Marquee"): 1.5 s still,
 * 40 px/s to the end, 1.5 s pause, snap back and repeat. Fitting text never moves. Under
 * reduced motion the text is clipped with an ellipsis instead. The repeated copy is
 * `aria-hidden`, so assistive tech reads the text once.
 */
export function Marquee({
  children,
  gap = 48,
  measure = measureOverflow,
  className,
}: MarqueeProps) {
  const reduceMotion = useReduceMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  const remeasure = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const { container, content } = measure(element);
    setDistance(overflows(container, content) ? content + gap : 0);
  }, [gap, measure]);

  useLayoutEffect(() => {
    remeasure();
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(remeasure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [remeasure, children]);

  const scrolling = distance > 0 && !reduceMotion;
  const timeline = marqueeTimeline(distance);

  return (
    <span
      ref={ref}
      className={cx('muna-marquee', className)}
      data-scrolling={scrolling || undefined}
      data-overflow={distance > 0 || undefined}
    >
      <motion.span
        className="muna-marquee__track"
        animate={scrolling ? { x: [0, 0, -distance, -distance] } : { x: 0 }}
        transition={
          scrolling
            ? {
                duration: timeline.durationS,
                times: timeline.times,
                ease: 'linear',
                repeat: Infinity,
              }
            : { duration: 0 }
        }
      >
        <span className="muna-marquee__copy">{children}</span>
        {scrolling && (
          <span
            className="muna-marquee__copy"
            aria-hidden="true"
            style={{ marginInlineStart: gap }}
          >
            {children}
          </span>
        )}
      </motion.span>
    </span>
  );
}
