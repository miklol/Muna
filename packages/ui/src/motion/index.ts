/**
 * Motion presets (docs/06-motion-spec.md) as physics springs, shaped like Motion `Transition`
 * objects so they drop straight into `motion.div` `transition` props. Module code imports from
 * `@muna/ui/motion` only — never literal durations or easings.
 *
 * `expand` and `collapse` land here for the M0-E2 window spike; M0-E4 completes the table.
 */

/** A physics spring as Motion understands it (`{ type: 'spring', stiffness, damping, mass }`). */
export interface SpringPreset {
  readonly type: 'spring';
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
}

const spring = (stiffness: number, damping: number, mass: number): SpringPreset => ({
  type: 'spring',
  stiffness,
  damping,
  mass,
});

/** Spring presets keyed by the names in the motion spec table. */
export const springs = {
  /** Strip → panel, strip → wide form, drop-tile row. */
  expand: spring(224, 24, 1),
  /** Panel → strip, wide → strip, dismiss (same spring as `expand`, critically damped). */
  collapse: spring(224, 30, 1),
} as const;

export type SpringName = keyof typeof springs;

/** Perceptual duration of a spring, `2π·√(mass / stiffness)`, in seconds (SwiftUI `response`). */
export const springResponse = (preset: SpringPreset): number =>
  2 * Math.PI * Math.sqrt(preset.mass / preset.stiffness);

/** Damping ratio ζ = `damping / (2·√(stiffness·mass))`; 1 is critically damped. */
export const springDampingRatio = (preset: SpringPreset): number =>
  preset.damping / (2 * Math.sqrt(preset.stiffness * preset.mass));

/** Media query honoured by `MotionConfig` and by pure-CSS hover states. */
export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
