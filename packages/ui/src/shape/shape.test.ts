import { afterEach, describe, expect, it, vi } from 'vitest';

import { notchClipPath, notchOuterWidth, notchOutline, notchPath, notchRadii } from './notch-path';
import {
  CORNER_SMOOTHING,
  resetCornerShapeSupport,
  squircleClipPath,
  squirclePath,
  supportsCornerShape,
} from './squircle';

describe('squirclePath', () => {
  it('produces a closed SVG path for a rounded rectangle', () => {
    const path = squirclePath({ width: 200, height: 100, radius: 28 });
    expect(path).toMatch(/^M /);
    expect(path.trim()).toMatch(/Z$/);
  });

  it('uses corner smoothing 0.6 by default', () => {
    expect(CORNER_SMOOTHING).toBe(0.6);
    const smoothed = squirclePath({ width: 200, height: 100, radius: 28 });
    const plain = squirclePath({ width: 200, height: 100, radius: 28, smoothing: 0 });
    expect(smoothed).not.toBe(plain);
  });

  it('supports per-corner radii (strip: bottom corners only)', () => {
    const strip = squirclePath({
      width: 200,
      height: 32,
      radius: { topLeft: 0, topRight: 0, bottomRight: 14, bottomLeft: 14 },
    });
    // Square top corners: the path passes through both top corners with no curve.
    expect(strip).toMatch(/^M 200 0 /);
    expect(strip).toContain('L 0 0');
    // Rounded bottom corners are smoothed arcs of the requested radius.
    expect(strip).toContain('a 14.0000 14.0000');
  });

  it('clamps a radius larger than half the shorter side (island pill)', () => {
    const pill = squirclePath({ width: 120, height: 36, radius: 32 });
    const capsule = squirclePath({ width: 120, height: 36, radius: 18 });
    expect(pill).toBe(capsule);
  });

  it('returns none as clip-path until the size is known', () => {
    expect(squircleClipPath({ width: 0, height: 0, radius: 12 })).toBe('none');
    expect(squircleClipPath({ width: 40, height: 40, radius: 12 })).toMatch(/^path\("M /);
  });
});

describe('supportsCornerShape', () => {
  afterEach(() => {
    resetCornerShapeSupport();
    vi.unstubAllGlobals();
  });

  it('is false when CSS.supports is unavailable', () => {
    vi.stubGlobal('CSS', undefined);
    expect(supportsCornerShape()).toBe(false);
  });

  it('memoises the detection', () => {
    const supports = vi.fn(() => true);
    vi.stubGlobal('CSS', { supports });
    expect(supportsCornerShape()).toBe(true);
    expect(supportsCornerShape()).toBe(true);
    expect(supports).toHaveBeenCalledTimes(1);
    expect(supports).toHaveBeenCalledWith('corner-shape', 'squircle');
  });
});

describe('notchPath', () => {
  const collapsed = { width: 200, height: 32, ...notchRadii.collapsed };
  const expanded = { width: 720, height: 240, ...notchRadii.expanded };

  it('uses the flare radii from the design system', () => {
    expect(notchRadii).toEqual({
      collapsed: { topRadius: 6, bottomRadius: 14 },
      expanded: { topRadius: 19, bottomRadius: 28 },
    });
  });

  it('is body width plus two flares wide', () => {
    expect(notchOuterWidth(collapsed)).toBe(212);
    expect(notchOuterWidth(expanded)).toBe(758);
  });

  it('starts flush with the screen edge and ends at the far top corner', () => {
    const path = notchPath(collapsed);
    expect(path).toBe(
      'M 0 0 A 6 6 0 0 1 6 6 L 6 18 A 14 14 0 0 0 20 32 L 192 32 A 14 14 0 0 0 206 18 L 206 6 A 6 6 0 0 1 212 0 Z',
    );
  });

  it('clamps the bottom radius to what fits', () => {
    const tiny = notchPath({ width: 20, height: 12, topRadius: 6, bottomRadius: 14 });
    // r = min(14, 10, 12 − 6) = 6
    expect(tiny).toContain('A 6 6 0 0 0 12 12');
  });

  it('wraps as clip-path and handles unknown sizes', () => {
    expect(notchClipPath(collapsed)).toBe(`path("${notchPath(collapsed)}")`);
    expect(notchClipPath({ ...collapsed, width: 0 })).toBe('none');
  });

  it('can leave the top edge open for the hairline outline', () => {
    const open = notchPath(collapsed, { closed: false });
    expect(open).not.toMatch(/Z$/);
    expect(`${open} Z`).toBe(notchPath(collapsed));
  });

  it('samples the outline clockwise from the screen edge, ending at the far top corner', () => {
    const points = notchOutline(collapsed, 4);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 212, y: 0 });
    // Four arcs of (segments + 1) points each.
    expect(points).toHaveLength(4 * 5);
    // Lowest point is the bottom edge.
    expect(Math.max(...points.map((p) => p.y))).toBe(32);
    // The body sides sit inside the flares.
    expect(points[4]).toEqual({ x: 6, y: 6 });
    expect(points[5]).toEqual({ x: 6, y: 18 });
  });
});
