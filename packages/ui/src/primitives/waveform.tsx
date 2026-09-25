import { motion, type MotionValue, motionValue, useSpring } from 'motion/react';
import { useEffect, useMemo } from 'react';

import { springs, timings } from '../motion/presets';
import { useReduceMotion } from '../motion/reduced-motion';
import { cx, type Tint, tintStyle } from './shared';
import './waveform.css';

export interface WaveformProps {
  /** Bars move while `true`; a paused waveform holds still at its resting heights. */
  playing: boolean;
  /** Number of bars; the strip's 20 px slot fits four. */
  bars?: number;
  /** Bar colour; media is `cyan`. */
  tint?: Tint;
  /** Box size in px; the bars span `amplitude.min`–`amplitude.max` of it. */
  size?: number;
  /** Magnitude source for a bar at a moment, 0–1; the default synthesises a beat-like pattern. */
  sample?: (bar: number, timeMs: number) => number;
  /** Clock the sampler runs on; tests inject a fake one. */
  now?: () => number;
  className?: string;
}

/** Bar heights in CSS px (docs/06-motion-spec.md "Waveform": amplitude 4–20 px). */
export const waveformAmplitude = { min: 4, max: 20 } as const;

/** Where the bars rest while paused (and under reduced motion): a quiet, uneven skyline. */
export const waveformRest: readonly number[] = [0.35, 0.6, 0.45, 0.25];

const TAU = Math.PI * 2;

/**
 * A magnitude without any audio behind it: three incommensurate sines per bar, phase-shifted
 * so neighbours never move in lockstep, folded into 0–1. Deterministic, so a story or a test
 * at a given moment always looks the same. The WASAPI loopback source replaces it in a later
 * epic (docs/modules/media.md, "Visualiser").
 */
export const syntheticSample = (bar: number, timeMs: number): number => {
  const t = timeMs / 1000;
  const phase = bar * 1.7;
  const slow = Math.sin(TAU * 0.9 * t + phase);
  const beat = Math.sin(TAU * 2.1 * t + phase * 2.3);
  const fast = Math.sin(TAU * 4.7 * t + phase * 0.6);
  const mixed = 0.5 + 0.28 * slow + 0.16 * beat + 0.06 * fast;
  return Math.min(1, Math.max(0, mixed));
};

/** Maps a 0–1 magnitude to the bar's `scaleY` for a box `size` px tall. */
export const barScale = (magnitude: number, size: number): number => {
  const px = waveformAmplitude.min + magnitude * (waveformAmplitude.max - waveformAmplitude.min);
  return Math.min(px, size) / size;
};

interface BarProps {
  target: MotionValue<number>;
}

function Bar({ target }: BarProps) {
  // The bar follows its target with the `interactive` spring, the way a slider fill follows
  // the pointer: a MotionValue chain, no React state per sample.
  const scaleY = useSpring(target, springs.interactive);
  return <motion.span className="muna-waveform__bar" style={{ scaleY }} />;
}

/**
 * Audio bars beside album art (docs/modules/media.md "Strip", docs/06-motion-spec.md
 * "Waveform"): sampled at 30 Hz while playing, each bar easing to its new height with the
 * `interactive` spring; frozen at its resting height while paused, under reduced motion and
 * while the document is hidden. Decorative — the strip's live region says "playing".
 */
export function Waveform({
  playing,
  bars = 4,
  tint = 'cyan',
  size = waveformAmplitude.max,
  sample = syntheticSample,
  now = Date.now,
  className,
}: WaveformProps) {
  const reduceMotion = useReduceMotion();
  const targets = useMemo(
    () =>
      Array.from({ length: bars }, (_, index) =>
        motionValue(barScale(waveformRest[index % waveformRest.length] ?? 0.4, size)),
      ),
    [bars, size],
  );
  const animating = playing && !reduceMotion;

  useEffect(() => {
    if (!animating) {
      targets.forEach((target, index) => {
        target.set(barScale(waveformRest[index % waveformRest.length] ?? 0.4, size));
      });
      return;
    }
    let interval: ReturnType<typeof setInterval> | null = null;
    const tick = () => {
      const time = now();
      targets.forEach((target, index) => {
        target.set(barScale(sample(index, time), size));
      });
    };
    const start = () => {
      if (interval === null) {
        tick();
        interval = setInterval(tick, 1000 / timings.waveformSampleHz);
      }
    };
    const stop = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop();
      } else {
        start();
      }
    };
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [animating, now, sample, size, targets]);

  return (
    <span
      aria-hidden="true"
      className={cx('muna-waveform', className)}
      data-playing={playing || undefined}
      style={tintStyle(tint, { inlineSize: size, blockSize: size })}
    >
      {targets.map((target, index) => (
        // Bars are positional and never reorder; the index is the identity.
        <Bar key={index} target={target} />
      ))}
    </span>
  );
}
