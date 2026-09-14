/**
 * Motion presets (docs/06-motion-spec.md) land with M0-E4 as physics springs exported as
 * Motion `Transition` objects. Module code imports from `@muna/ui/motion` only — never
 * literal durations or easings.
 */

/** Media query honoured by `MotionConfig` and by pure-CSS hover states. */
export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
