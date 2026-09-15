import { animate, type MotionStyle, motion, useMotionValue } from 'motion/react';
import { useEffect } from 'react';
import { ProgressBar, type ProgressBarProps } from 'react-aria-components';

import { useMotionPreset } from '../motion/reduced-motion';
import './progress-track.css';
import { cx, type Tint, tintStyle } from './shared';

export interface ProgressTrackProps extends Omit<
  ProgressBarProps,
  'className' | 'style' | 'children' | 'isIndeterminate'
> {
  /** Fill colour; media is `cyan`, Pomodoro `orange`. */
  tint?: Tint;
  /** Shows the 12 px thumb on hover (seekable media). */
  seekable?: boolean;
  className?: string;
}

/**
 * 4 px progress track (docs/05-design-system.md#spacing--sizing). The fill follows the value
 * with the `interactive` spring. The animated quantity is one custom property, `--muna-progress`
 * (0–1); CSS turns it into `scaleX` for the fill and a `translate` for the thumb, flipping both
 * for right-to-left text. Needs `aria-label` or `aria-labelledby` like any progress bar.
 */
export function ProgressTrack({
  tint = 'accent',
  seekable = false,
  className,
  value = 0,
  minValue = 0,
  maxValue = 100,
  ...rest
}: ProgressTrackProps) {
  const target = maxValue > minValue ? (value - minValue) / (maxValue - minValue) : 0;
  const fraction = Math.min(1, Math.max(0, target));
  const progress = useMotionValue(fraction);
  const transition = useMotionPreset('interactive');

  useEffect(() => {
    const controls = animate(progress, fraction, transition);
    return () => {
      controls.stop();
    };
  }, [fraction, progress, transition]);

  return (
    <ProgressBar
      {...rest}
      value={value}
      minValue={minValue}
      maxValue={maxValue}
      className={cx('muna-progress-track', seekable && 'muna-progress-track--seekable', className)}
      style={tintStyle(tint)}
    >
      <motion.span
        className="muna-progress-track__motion"
        style={{ '--muna-progress': progress } as MotionStyle}
      >
        <span className="muna-progress-track__fill" />
        {seekable && <span className="muna-progress-track__thumb" />}
      </motion.span>
    </ProgressBar>
  );
}
