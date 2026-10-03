import { reducedMotionTransition, springs, timings } from '@muna/ui/motion';
import { describe, expect, it } from 'vitest';

import { morphTransition } from './morph-transition';

describe('morphTransition', () => {
  it('expands into the panel and collapses out of it after the content has left', () => {
    expect(morphTransition('collapsed', 'expanded', false, false)).toBe(springs.expand);
    expect(morphTransition('hoverReveal', 'pinned', false, false)).toBe(springs.expand);
    expect(morphTransition('expanded', 'collapsed', false, false)).toEqual({
      ...springs.collapse,
      delay: timings.shapeFollowDelayMs / 1000,
    });
    expect(morphTransition('pinned', 'peek', false, false)).toEqual({
      ...springs.collapse,
      delay: timings.shapeFollowDelayMs / 1000,
    });
  });

  it('reveals between strip forms and between the open states', () => {
    expect(morphTransition('collapsed', 'hoverReveal', false, false)).toBe(springs.reveal);
    expect(morphTransition('hoverReveal', 'collapsed', false, false)).toBe(springs.reveal);
    expect(morphTransition('collapsed', 'peek', false, false)).toBe(springs.reveal);
    expect(morphTransition('expanded', 'pinned', false, false)).toBe(springs.reveal);
  });

  it('treats a same-state size change as the wide form in or out, or a module switch', () => {
    expect(morphTransition('collapsed', 'collapsed', true, false)).toBe(springs.expand);
    expect(morphTransition('collapsed', 'collapsed', false, false)).toBe(springs.collapse);
    expect(morphTransition('expanded', 'expanded', false, false)).toBe(springs.switch);
    expect(morphTransition('pinned', 'pinned', false, false)).toBe(springs.switch);
  });

  it('drop actions: expands into the row, collapses out of it, switches from a panel or for a second row', () => {
    expect(morphTransition('collapsed', 'drop', false, false)).toBe(springs.expand);
    expect(morphTransition('peek', 'drop', false, false)).toBe(springs.expand);
    expect(morphTransition('hoverReveal', 'drop', true, false)).toBe(springs.expand);
    expect(morphTransition('drop', 'collapsed', false, false)).toEqual({
      ...springs.collapse,
      delay: timings.shapeFollowDelayMs / 1000,
    });
    expect(morphTransition('drop', 'peek', false, false)).toEqual({
      ...springs.collapse,
      delay: timings.shapeFollowDelayMs / 1000,
    });
    expect(morphTransition('expanded', 'drop', false, false)).toBe(springs.switch);
    expect(morphTransition('pinned', 'drop', false, false)).toBe(springs.switch);
    expect(morphTransition('drop', 'drop', false, false)).toBe(springs.switch);
    expect(morphTransition('collapsed', 'drop', false, true)).toBe(reducedMotionTransition);
  });

  it('S14: uses the 150 ms ease-out for every morph under reduced motion', () => {
    expect(morphTransition('collapsed', 'expanded', false, true)).toBe(reducedMotionTransition);
    expect(morphTransition('expanded', 'collapsed', false, true)).toBe(reducedMotionTransition);
    expect(morphTransition('collapsed', 'hoverReveal', true, true)).toBe(reducedMotionTransition);
    expect(reducedMotionTransition).toMatchObject({ duration: 0.15 });
    expect(reducedMotionTransition).not.toHaveProperty('stiffness');
  });
});
