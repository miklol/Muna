import { describe, expect, it } from 'vitest';

import { springDampingRatio, springResponse, springs } from './index';

// Values from the "Spring presets" table in docs/06-motion-spec.md (response / ζ).
describe('spring presets', () => {
  it('expand matches response 0.42 / ζ 0.80', () => {
    expect(springResponse(springs.expand)).toBeCloseTo(0.42, 2);
    expect(springDampingRatio(springs.expand)).toBeCloseTo(0.8, 2);
  });

  it('collapse is the same spring, critically damped', () => {
    expect(springs.collapse.stiffness).toBe(springs.expand.stiffness);
    expect(springResponse(springs.collapse)).toBeCloseTo(0.42, 2);
    expect(springDampingRatio(springs.collapse)).toBeCloseTo(1, 2);
  });

  it('every preset is a Motion physics spring', () => {
    for (const preset of Object.values(springs)) {
      expect(preset.type).toBe('spring');
      expect(preset.stiffness).toBeGreaterThan(0);
      expect(preset.damping).toBeGreaterThan(0);
      expect(preset.mass).toBeGreaterThan(0);
    }
  });
});
