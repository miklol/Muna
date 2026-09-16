/**
 * Reduced motion (docs/06-motion-spec.md#reduced-motion): `prefers-reduced-motion: reduce`
 * **or** Settings → Appearance → Reduce motion. `MunaMotionProvider` sits at the root of each
 * window; `useMotionPreset(name)` hands components the right transition.
 */
import { MotionConfig, type Transition, useReducedMotion } from 'motion/react';
import { createContext, type ReactNode, useContext, useEffect } from 'react';

import { applyMotionCssVars } from './css-vars';
import { reducedMotionTransition, type SpringName, springs, timings } from './presets';

/** Media query honoured by `MotionConfig` and by pure-CSS hover states. */
export const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

/** The app's own "Reduce motion" setting; `false` defers to the OS preference. */
const ReduceMotionSettingContext = createContext(false);

/** True while the OS preference is deliberately ignored (measurement builds only). */
const IgnoreSystemPreferenceContext = createContext(false);

/** True inside any provider, so nested providers leave `<html>` to the outermost one. */
const InsideProviderContext = createContext(false);

export interface MunaMotionProviderProps {
  /** Settings → Appearance → Reduce motion. Adds to, never overrides, the OS preference. */
  reduceMotion?: boolean;
  /**
   * Runs the full motion even when the OS asks for reduced motion. A measurement aid for dev
   * builds and perf runners (Windows Server ships with animations off); never set from user
   * settings. The `reduceMotion` setting still wins.
   */
  ignoreSystemPreference?: boolean;
  children: ReactNode;
}

/**
 * Root motion configuration: `MotionConfig reducedMotion="user"` so Motion follows the OS,
 * upgraded to `"always"` when the app setting is on. Also publishes the preset easings for
 * pure-CSS states and mirrors the setting as `data-reduce-motion` on `<html>`. Nested providers
 * (Storybook comparisons, previews) only affect JS-driven motion in their subtree; pure-CSS
 * states follow the window-level setting.
 */
export function MunaMotionProvider({
  reduceMotion = false,
  ignoreSystemPreference = false,
  children,
}: MunaMotionProviderProps) {
  const nested = useContext(InsideProviderContext);
  useEffect(() => {
    if (nested) return;
    applyMotionCssVars(document.documentElement, reduceMotion);
  }, [nested, reduceMotion]);
  const configured = reduceMotion ? 'always' : ignoreSystemPreference ? 'never' : 'user';
  return (
    <InsideProviderContext.Provider value={true}>
      <ReduceMotionSettingContext.Provider value={reduceMotion}>
        <IgnoreSystemPreferenceContext.Provider value={ignoreSystemPreference}>
          <MotionConfig reducedMotion={configured}>{children}</MotionConfig>
        </IgnoreSystemPreferenceContext.Provider>
      </ReduceMotionSettingContext.Provider>
    </InsideProviderContext.Provider>
  );
}

/** True when the OS asks for reduced motion or the app setting is on. */
export function useReduceMotion(): boolean {
  const setting = useContext(ReduceMotionSettingContext);
  const ignoreSystem = useContext(IgnoreSystemPreferenceContext);
  const system = useReducedMotion();
  return setting || (system === true && !ignoreSystem);
}

/**
 * The transition for a named preset, or the 150 ms ease-out replacement under reduced motion.
 * Pure helper for code outside React (stores, schedulers); components use `useMotionPreset`.
 */
export const resolveMotionPreset = (name: SpringName, reduceMotion: boolean): Transition =>
  reduceMotion ? reducedMotionTransition : springs[name];

/** `springs[name]`, or the reduced-motion transition when either switch is on. */
export function useMotionPreset(name: SpringName): Transition {
  return resolveMotionPreset(name, useReduceMotion());
}

/**
 * Hold times grow by 50 % under reduced motion (notices, wide form). Returns the adjusted
 * milliseconds so schedulers never hard-code the multiplier.
 */
export function useHoldTime(baseMs: number): number {
  return useReduceMotion() ? baseMs * timings.reducedMotionHoldMultiplier : baseMs;
}
