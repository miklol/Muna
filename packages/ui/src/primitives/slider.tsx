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
  className?: string;
}

interface FillProps {
  fraction: number;
  dragging: boolean;
}

function Fill({ fraction, dragging }: FillProps) {
  const progress = useMotionValue(fraction);
  const transition = useMotionPreset('interactive');
  useEffect(() => {
    if (dragging) {
      // The pointer owns the value: no spring between it and the fill.
      progress.set(fraction);
      return;
    }
    const controls = animate(progress, fraction, transition);
    return () => {
      controls.stop();
    };
  }, [dragging, fraction, progress, transition]);
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
 * tint, 12 px knob shown on hover, focus and drag. The fill follows value changes with the
 * `interactive` spring except while dragging, when it tracks the pointer directly. Keyboard:
 * arrows step, Page Up/Down step by ten, Home/End jump.
 */
export function Slider({ tint = 'accent', className, ...rest }: SliderProps) {
  return (
    <AriaSlider {...rest} className={cx('muna-slider', className)} style={tintStyle(tint)}>
      <SliderTrack className="muna-slider__track">
        {({ state }) => (
          <>
            <Fill fraction={state.getThumbPercent(0)} dragging={state.isThumbDragging(0)} />
            <SliderThumb index={0} className="muna-slider__thumb" />
          </>
        )}
      </SliderTrack>
    </AriaSlider>
  );
}
