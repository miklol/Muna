import { describe, expect, it } from 'vitest';

import {
  reducedMotionTransition,
  shellSpringNames,
  type SpringName,
  springDampingRatio,
  springNames,
  springResponse,
  springs,
  timings,
  toAppleSpring,
  toLinearEasing,
} from './presets';

// The "Spring presets" table in docs/06-motion-spec.md: response / ζ per preset.
const table: Record<SpringName, { response: number; zeta: number }> = {
  expand: { response: 0.42, zeta: 0.8 },
  collapse: { response: 0.42, zeta: 1 },
  reveal: { response: 0.32, zeta: 0.9 },
  notice: { response: 0.24, zeta: 0.7 },
  content: { response: 0.22, zeta: 0.96 },
  switch: { response: 0.35, zeta: 0.84 },
  toggle: { response: 0.28, zeta: 0.67 },
  drag: { response: 0.38, zeta: 0.8 },
  interactive: { response: 0.15, zeta: 0.86 },
  press: { response: 0.15, zeta: 1 },
  layout: { response: 0.42, zeta: 0.94 },
  hide: { response: 0.35, zeta: 0.84 },
};

describe('spring presets', () => {
  it('lists every preset from the spec table, in table order', () => {
    expect(springNames).toEqual(Object.keys(table));
  });

  it.each(Object.entries(table))('%s matches the spec response / ζ', (name, expected) => {
    const preset = springs[name as SpringName];
    expect(springResponse(preset)).toBeCloseTo(expected.response, 2);
    expect(springDampingRatio(preset)).toBeCloseTo(expected.zeta, 2);
  });

  it('collapse is the expand spring, critically damped', () => {
    expect(springs.collapse.stiffness).toBe(springs.expand.stiffness);
    expect(springs.collapse.mass).toBe(springs.expand.mass);
    expect(springDampingRatio(springs.collapse)).toBeCloseTo(1, 2);
  });

  it('every preset is a physics spring, never a duration/bounce spring', () => {
    for (const preset of Object.values(springs)) {
      expect(preset.type).toBe('spring');
      expect(preset.stiffness).toBeGreaterThan(0);
      expect(preset.damping).toBeGreaterThan(0);
      expect(preset.mass).toBeGreaterThan(0);
      expect(preset).not.toHaveProperty('duration');
      expect(preset).not.toHaveProperty('bounce');
      expect(preset).not.toHaveProperty('visualDuration');
    }
  });

  it('shell presets are a subset of the table', () => {
    for (const name of shellSpringNames) expect(springNames).toContain(name);
  });

  it('settles well under the 600 ms budget for every preset', () => {
    for (const preset of Object.values(springs)) {
      expect(springResponse(preset)).toBeLessThan(0.6);
    }
  });
});

describe('toAppleSpring', () => {
  it("matches Motion's Apple-style shorthand: visualDuration = response / 1.2, bounce = 1 − ζ", () => {
    const apple = toAppleSpring(springs.expand);
    expect(apple.response).toBeCloseTo(0.42, 2);
    expect(apple.dampingFraction).toBeCloseTo(0.8, 2);
    expect(apple.visualDuration).toBeCloseTo(0.42 / 1.2, 3);
    expect(apple.bounce).toBeCloseTo(0.2, 2);
  });

  it('never reports negative bounce for over-damped springs', () => {
    expect(toAppleSpring(springs.collapse).bounce).toBe(0);
  });
});

describe('toLinearEasing', () => {
  it('renders a preset as a CSS linear() easing with its duration', () => {
    const easing = toLinearEasing(springs.reveal);
    expect(easing.easing).toMatch(/^linear\(0, .*1\)$/);
    expect(easing.css).toBe(`${easing.durationMs}ms ${easing.easing}`);
    expect(easing.durationMs).toBeGreaterThan(100);
    expect(easing.durationMs).toBeLessThan(1000);
  });

  it('overshoots for bouncy presets and not for critically damped ones', () => {
    const values = (name: SpringName) =>
      toLinearEasing(springs[name]).easing.slice('linear('.length, -1).split(', ').map(Number);
    expect(Math.max(...values('notice'))).toBeGreaterThan(1);
    expect(Math.max(...values('collapse'))).toBeLessThanOrEqual(1);
  });
});

describe('reduced motion and timings', () => {
  it('replaces springs with a 150 ms ease-out', () => {
    expect(reducedMotionTransition).toEqual({ duration: 0.15, ease: [0.2, 0, 0, 1] });
  });

  it('keeps the spec timings', () => {
    expect(timings.hoverIntentMs).toBe(250);
    expect(timings.revealToExpandMs).toBe(600);
    expect(timings.contentEnterDelayMs).toBe(60);
    expect(timings.contentExitMs).toBe(80);
    expect(timings.collapseToActivityMs).toBe(150);
    expect(timings.noticeHoldMs).toBe(4000);
    expect(timings.staggerMs).toBe(30);
    expect(timings.reducedMotionHoldMultiplier).toBe(1.5);
  });
});
