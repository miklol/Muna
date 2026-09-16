import { reducedMotionTransition, springs, timings } from '@muna/ui/motion';
import type { Transition } from 'motion/react';

import type { ShellState } from './machine';
import { showsPanel } from './shell-geometry';

/**
 * Which preset moves the silhouette between two states (docs/06-motion-spec.md, "Strip →
 * panel" choreography): `expand` into the panel, `collapse` out of it — after the content has
 * left, so the shape follows by `shapeFollowDelayMs` — and `reveal` for the hover reveal. A
 * same-state size change is the wide form (`expand` in, `collapse` out) or, under an open
 * panel, a module switch whose height springs with `switch` ("Module switch"). Under reduced
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
  if (showsPanel(to) && !showsPanel(from)) {
    return springs.expand;
  }
  if (showsPanel(from) && !showsPanel(to)) {
    return { ...springs.collapse, delay: timings.shapeFollowDelayMs / 1000 };
  }
  if (from === to) {
    if (showsPanel(to)) {
      return springs.switch;
    }
    return wide ? springs.expand : springs.collapse;
  }
  return springs.reveal;
};
