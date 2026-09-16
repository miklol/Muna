/**
 * Spring presets from docs/06-motion-spec.md#spring-presets as **physics springs**
 * (`stiffness / damping / mass`). Physics springs inherit velocity when retargeted, so a
 * hover-out mid-expand reverses from the current position; Motion's `{ duration, bounce }`
 * springs deliberately do not, which is why no preset is ever expressed that way.
 *
 * Module code imports from `@muna/ui/motion` only and never writes `duration`, `ease`,
 * `stiffness` or `damping` literals. Tuning happens in the Storybook "Motion" playground and
 * lands as a change to the table in the motion spec, then here.
 */
import { spring as motionSpring } from 'motion';
import type { Transition } from 'motion/react';

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

/** Spring presets keyed by the names in the motion spec table, in table order. */
export const springs = {
  /** Strip → panel, strip → wide form, drop-tile row. */
  expand: spring(224, 24, 1),
  /** Panel → strip, wide → strip, dismiss (same spring as `expand`, critically damped). */
  collapse: spring(224, 30, 1),
  /** Hover reveal (+16 w, +4 h), peek ↔ strip. */
  reveal: spring(300, 28, 0.8),
  /** Live activity arriving, BT connect, charging, drop confirmation pulse. */
  notice: spring(700, 38, 1.05),
  /** Content enter (opacity, scale, y, blur). */
  content: spring(540, 36, 0.65),
  /** Module switch height, segmented indicator, module-bar pill. */
  switch: spring(322, 30, 1),
  /** Toggles, chip select, tile hover grow, snap zones appear. */
  toggle: spring(500, 30, 1),
  /** Drag-driven shell size/position (shelf drag, zone follow). */
  drag: spring(273, 26.5, 1),
  /** Slider thumb/fill following the pointer, ring value updates, waveform bars. */
  interactive: spring(1755, 72, 1),
  /** Button scale 1 → 0.96 → 1. */
  press: spring(1755, 84, 1),
  /** Reorder in module bar / dashboard, list insert/remove. */
  layout: spring(224, 28, 1),
  /** Slide up and out before parking (fullscreen, monitor change). */
  hide: spring(320, 30, 1),
} as const satisfies Record<string, SpringPreset>;

export type SpringName = keyof typeof springs;

/** Preset names in table order, for playgrounds and exhaustive tests. */
export const springNames = Object.keys(springs) as readonly SpringName[];

/**
 * Presets that drive the shell silhouette. They must stay physics springs so an interrupted
 * morph reverses with its velocity intact (motion spec, principle 7).
 */
export const shellSpringNames = [
  'expand',
  'collapse',
  'reveal',
  'notice',
  'drag',
  'hide',
] as const satisfies readonly SpringName[];

/** Perceptual duration of a spring, `2π·√(mass / stiffness)`, in seconds (SwiftUI `response`). */
export const springResponse = (preset: SpringPreset): number =>
  2 * Math.PI * Math.sqrt(preset.mass / preset.stiffness);

/** Damping ratio ζ = `damping / (2·√(stiffness·mass))`; 1 is critically damped. */
export const springDampingRatio = (preset: SpringPreset): number =>
  preset.damping / (2 * Math.sqrt(preset.stiffness * preset.mass));

/** SwiftUI-style description of a preset, for reviewers who think in `response` / `dampingFraction`. */
export interface AppleSpring {
  /** `.spring(response:)` in seconds. */
  readonly response: number;
  /** `.spring(dampingFraction:)`, 1 = no bounce. */
  readonly dampingFraction: number;
  /** Motion's Apple-style shorthand `visualDuration` = `response / 1.2`, seconds. */
  readonly visualDuration: number;
  /** Motion's Apple-style shorthand `bounce` = `1 − ζ`, clamped at 0. */
  readonly bounce: number;
}

/**
 * Exact conversion of a physics preset to the SwiftUI / Motion-shorthand columns of the spec
 * table. Documentation only — never feed the result back into a `transition` (see above).
 */
export const toAppleSpring = (preset: SpringPreset): AppleSpring => {
  const response = springResponse(preset);
  const dampingFraction = springDampingRatio(preset);
  return {
    response,
    dampingFraction,
    visualDuration: response / 1.2,
    bounce: Math.max(0, 1 - dampingFraction),
  };
};

/** A preset rendered as a CSS `linear()` easing for pure-CSS hover states. */
export interface LinearEasing {
  /** Settle time in milliseconds, as Motion computed it. */
  readonly durationMs: number;
  /** `linear(0, 0.08, …, 1)` — Chromium ≥ 113. */
  readonly easing: string;
  /** `"<duration>ms <easing>"`, ready for `transition: transform var(--x)`. */
  readonly css: string;
}

const linearEasingPattern = /^(\d+(?:\.\d+)?)ms\s+(linear\(.*\))$/s;

/**
 * Renders a preset as a CSS `linear()` easing (`spring(...).toString()` from Motion) so
 * pure-CSS hovers use the same physics as JS-driven animation. Only for CSS transitions that
 * are never interrupted mid-flight — a CSS transition cannot inherit velocity.
 */
export const toLinearEasing = (preset: SpringPreset): LinearEasing => {
  const generated = motionSpring({
    keyframes: [0, 1],
    stiffness: preset.stiffness,
    damping: preset.damping,
    mass: preset.mass,
  }).toString();
  const match = linearEasingPattern.exec(generated);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Motion returned an unexpected easing string: ${generated}`);
  }
  return { durationMs: Number(match[1]), easing: match[2], css: generated };
};

/**
 * Reduced-motion replacement for every spring (docs/06-motion-spec.md#reduced-motion):
 * 150 ms ease-out, no bounce. Shape changes still happen; content only crossfades.
 */
export const reducedMotionTransition = {
  duration: 0.15,
  ease: [0.2, 0, 0, 1],
} as const satisfies Transition;

/**
 * Content transition recipe (docs/06-motion-spec.md#content-transition-recipe): every piece of
 * content inside the shell enters by condensing into place and exits before the shell clips it.
 */
export const contentRecipe = {
  /** Enter start for nodes ≤ 320 × 160 px (blur allowed). */
  enterFrom: { opacity: 0, scale: 0.9, y: -6, filter: 'blur(5px)' },
  /** Enter start for larger bodies: opacity + scale only. */
  enterFromLarge: { opacity: 0, scale: 0.9, y: -6 },
  /** At rest. */
  visible: { opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' },
  /** Exit target: no blur, content is gone before the shape moves. */
  exitTo: { opacity: 0, scale: 0.96 },
  /** Under reduced motion content only crossfades. */
  reducedEnterFrom: { opacity: 0 },
  reducedVisible: { opacity: 1 },
  reducedExitTo: { opacity: 0 },
  /** Largest node that may enter with blur. */
  blurMaxSize: { width: 320, height: 160 },
} as const;

/** Content exit: 80 ms ease-out (`timings.contentExitMs`). */
export const contentExitTransition = {
  duration: 0.08,
  ease: [0.2, 0, 0, 1],
} as const satisfies Transition;

/**
 * Module bar choreography (docs/06-motion-spec.md "Strip → panel" and "Panel → strip"): the
 * pill rises 12 px into place with `expand` 80 ms after the shape starts, and drops 8 px while
 * fading together with the content exit.
 */
export const moduleBarRecipe = {
  enterFrom: { opacity: 0, y: -12 },
  visible: { opacity: 1, y: 0 },
  exitTo: { opacity: 0, y: 8 },
  reducedEnterFrom: { opacity: 0 },
  reducedVisible: { opacity: 1 },
  reducedExitTo: { opacity: 0 },
} as const;

/**
 * Non-spring timings from docs/06-motion-spec.md#timings-non-spring, in milliseconds unless
 * the name says otherwise. Module code reads these instead of writing numbers.
 */
export const timings = {
  /** Hover intent before reveal. */
  hoverIntentMs: 250,
  /** Hover intent is ignored while the cursor moves faster than this. */
  hoverIntentMaxVelocityPxPerS: 800,
  /** Continuous hover before reveal becomes expand; click or scroll expand immediately. */
  revealToExpandMs: 600,
  /** Hover-out grace from the reveal state. */
  hoverOutGraceRevealMs: 150,
  /** Hover-out grace from the expanded state. */
  hoverOutGraceExpandedMs: 300,
  /** Extended hover padding around the shape. */
  hoverPaddingPx: 30,
  /** Content enters this long after the shape starts moving. */
  contentEnterDelayMs: 60,
  /** The module bar enters this long after the shape starts moving. */
  moduleBarEnterDelayMs: 80,
  /** A module switch: the new body enters this long after the old one starts leaving. */
  moduleSwitchEnterDelayMs: 40,
  /** Content exit duration; the shape follows `shapeFollowDelayMs` later. */
  contentExitMs: 80,
  /** Shape starts collapsing this long after content begins to exit. */
  shapeFollowDelayMs: 40,
  /** After a collapse settles, whatever live activity is due appears this long later. */
  collapseToActivityMs: 150,
  /** Wide form hold on track change before `collapse`. */
  wideFormHoldMs: 2500,
  /** HUD linger after the last value change. */
  hudLingerMs: 1500,
  /** Notice default hold (priority table in the live-activities module doc). */
  noticeHoldMs: 4000,
  /** Tie rotation between activities, `switch` crossfade. */
  tieRotationMs: 8000,
  /** Park/unpark debounce so fullscreen flapping never flickers. */
  parkDebounceMs: 500,
  /** Stagger per item for tiles, lists and widgets. */
  staggerMs: 30,
  /** Maximum items animating concurrently in a stagger. */
  staggerMaxConcurrent: 8,
  /** Marquee starts after this long, only if the text overflows. */
  marqueeStartDelayMs: 1500,
  /** Marquee speed. */
  marqueeSpeedPxPerS: 40,
  /** Marquee pause at the end before it loops. */
  marqueeEndPauseMs: 1500,
  /** Progress bars step once per second, interpolated with `interactive` on seek. */
  progressStepMs: 1000,
  /** Waveform sample rate. */
  waveformSampleHz: 30,
  /** Skeleton shimmer loop. */
  shimmerLoopMs: 1600,
  /** Hold times grow by this factor under reduced motion. */
  reducedMotionHoldMultiplier: 1.5,
} as const;

export type TimingName = keyof typeof timings;
