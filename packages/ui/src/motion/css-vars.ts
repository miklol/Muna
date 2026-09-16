/**
 * Preset easings for pure-CSS states (hover tint, press scale, chip select): each preset is
 * rendered once as `"<ms>ms linear(...)"` and exposed as a custom property. Primitives write
 * `transition: transform var(--muna-motion-press)`; `MunaMotionProvider` sets the properties
 * on `<html>`. Without a provider the properties are undefined and the state changes are
 * instant — never a literal duration.
 */
import { springs, timings, toLinearEasing } from './presets';

export const motionCssVars = {
  '--muna-motion-press': toLinearEasing(springs.press).css,
  '--muna-motion-toggle': toLinearEasing(springs.toggle).css,
  '--muna-motion-reveal': toLinearEasing(springs.reveal).css,
  /** Fills that follow a value (battery level, HUD track). */
  '--muna-motion-interactive': toLinearEasing(springs.interactive).css,
  /** Skeleton shimmer loop (`timings.shimmerLoopMs`, linear). */
  '--muna-motion-shimmer': `${String(timings.shimmerLoopMs)}ms linear`,
} as const;

export type MotionCssVar = keyof typeof motionCssVars;

/** Attribute set on `<html>` while the app's Reduce motion setting is on; CSS mirrors the media query. */
export const reduceMotionAttribute = 'data-reduce-motion';

/** Writes the preset properties (and the reduce-motion attribute) onto a root element. */
export const applyMotionCssVars = (root: HTMLElement, reduceMotion: boolean): void => {
  for (const [name, value] of Object.entries(motionCssVars)) {
    root.style.setProperty(name, value);
  }
  root.toggleAttribute(reduceMotionAttribute, reduceMotion);
};
