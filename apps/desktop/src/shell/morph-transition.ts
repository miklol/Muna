import { reducedMotionTransition, springs, timings } from '@muna/ui/motion';
import type { Transition } from 'motion/react';

import type { ShellState } from './machine';
import { showsDrop, showsLarge } from './shell-geometry';

/**
 * Which preset moves the silhouette between two states (docs/06-motion-spec.md, "Strip →
 * panel" choreography): `expand` into the panel or the drop row, `collapse` out of either —
 * after the content has left, so the shape follows by `shapeFollowDelayMs` — and `reveal` for
 * the hover reveal. A same-state size change is the wide form (`expand` in, `collapse` out)
 * or, under a large silhouette, a module switch or the row's second row, whose height springs
 * with `switch` ("Module switch"); so does a drag arriving over an open panel. Under reduced
 * motion every morph is the 150 ms ease-out (S14).
 */
export const morphTransition = (
  from: ShellState,
  to: ShellState,
  wide: boolean,
  reduceMotion: boolean,
): Transition => {
  if (reduceMotion) {
    return reducedMotionTransition;
  }
  if (showsLarge(to) && !showsLarge(from)) {
    return springs.expand;
  }
  if (showsLarge(from) && !showsLarge(to)) {
    return { ...springs.collapse, delay: timings.shapeFollowDelayMs / 1000 };
  }
  if (from === to) {
    if (showsLarge(to)) {
      return springs.switch;
    }
    return wide ? springs.expand : springs.collapse;
  }
  if (showsDrop(from) || showsDrop(to)) {
    return springs.switch;
  }
  return springs.reveal;
};
