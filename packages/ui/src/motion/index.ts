/**
 * `@muna/ui/motion`: spring presets, timings and the reduced-motion switch from
 * docs/06-motion-spec.md. Module code imports from here only — never literal durations or
 * easings.
 */
export {
  applyMotionCssVars,
  type MotionCssVar,
  motionCssVars,
  reduceMotionAttribute,
} from './css-vars';
export {
  type AppleSpring,
  contentExitTransition,
  contentRecipe,
  type LinearEasing,
  moduleBarRecipe,
  reducedMotionTransition,
  shellSpringNames,
  type SpringName,
  type SpringPreset,
  springDampingRatio,
  springNames,
  springResponse,
  springs,
  type TimingName,
  timings,
  toAppleSpring,
  toLinearEasing,
} from './presets';
export {
  MunaMotionProvider,
  type MunaMotionProviderProps,
  reducedMotionQuery,
  resolveMotionPreset,
  useHoldTime,
  useMotionPreset,
  useReduceMotion,
} from './reduced-motion';
