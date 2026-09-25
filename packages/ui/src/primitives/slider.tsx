import { animate, type MotionStyle, motion, useMotionValue } from 'motion/react';
import { useEffect } from 'react';
import {
  Slider as AriaSlider,
  type SliderProps as AriaSliderProps,
  SliderThumb,
  SliderTrack,
} from 'react-aria-components';

import { useMotionPreset } from '../motion/reduced-motion';
import { cx, type Tint, tintStyle } from './shared';
import './slider.css';

export interface SliderProps extends Omit<
  AriaSliderProps<number>,
  'className' | 'style' | 'children' | 'orientation'
> {
  /** Required: the HUD slider has no visible caption. */
  'aria-label': string;
  /** Fill colour; volume and brightness use the accent. */
  tint?: Tint;
  /**
   * `tint` paints the fill in the tint; `plain` paints it `--text-1` (the strip's HUD level
   * track, docs/modules/hud.md "Visual").
   */
  fill?: 'tint' | 'plain';
  /**
   * The output is muted: the fill drains to empty with `collapse` while the value (and what
   * assistive technology reads) stays put; unmuting refills with `interactive`.
   */
  muted?: boolean;
  className?: string;
}

interface FillProps {
  fraction: number;
  dragging: boolean;
  muted: boolean;
}

function Fill({ fraction, dragging, muted }: FillProps) {
  const shown = muted ? 0 : fraction;
  const progress = useMotionValue(shown);
  const follow = useMotionPreset('interactive');
  const drain = useMotionPreset('collapse');
  useEffect(() => {
    if (dragging && !muted) {
      // The pointer owns the value: no spring between it and the fill.
      progress.set(shown);
      return;
    }
    const controls = animate(progress, shown, muted ? drain : follow);
    return () => {
      controls.stop();
    };
  }, [dragging, drain, follow, muted, progress, shown]);
  return (
    <motion.span
      aria-hidden="true"
      className="muna-slider__motion"
      style={{ '--muna-slider': progress } as MotionStyle}
    >
      <span className="muna-slider__fill" />
      <span className="muna-slider__knob" />
    </motion.span>
  );
}

/**
 * HUD slider (docs/05-design-system.md#spacing--sizing): 96 × 6 track, radius 3, fill in the
 * tint (or plain white), 12 px knob shown on hover, focus and drag. The fill follows value
 * changes with the `interactive` spring except while dragging, when it tracks the pointer
 * directly; a mute drains it with `collapse` (docs/06-motion-spec.md "HUD"). Keyboard: arrows
 * step, Page Up/Down step by ten, Home/End jump.
 */
export function Slider({
  tint = 'accent',
  fill = 'tint',
  muted = false,
  className,
  ...rest
}: SliderProps) {
  return (
    <AriaSlider
      {...rest}
      className={cx('muna-slider', fill === 'plain' && 'muna-slider--plain', className)}
      {...(fill === 'plain' ? {} : { style: tintStyle(tint) })}
      data-muted={muted || undefined}
    >
      <SliderTrack className="muna-slider__track">
        {({ state }) => (
          <>
            <Fill
              fraction={state.getThumbPercent(0)}
              dragging={state.isThumbDragging(0)}
              muted={muted}
            />
            <SliderThumb index={0} className="muna-slider__thumb" />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
