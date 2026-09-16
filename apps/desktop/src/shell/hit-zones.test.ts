import { describe, expect, it } from 'vitest';

import { anchoredBox, contains, padded, SpeedTracker, toShapeRect, union } from './hit-zones';

const box = { left: 100, top: 0, width: 200, height: 32 };

describe('hit zones', () => {
  it('contains is half-open on the right and bottom edges', () => {
    expect(contains(box, { x: 100, y: 0 })).toBe(true);
    expect(contains(box, { x: 299.9, y: 31.9 })).toBe(true);
    expect(contains(box, { x: 300, y: 10 })).toBe(false);
    expect(contains(box, { x: 150, y: 32 })).toBe(false);
    expect(contains(box, { x: 99, y: 10 })).toBe(false);
  });

  it('pads by the extended hover padding of the motion spec (30 px)', () => {
    expect(padded(box)).toEqual({ left: 70, top: -30, width: 260, height: 92 });
    expect(padded(box, 10)).toEqual({ left: 90, top: -10, width: 220, height: 52 });
  });

  it('unions to the smallest box around both', () => {
    expect(union(box, { left: 50, top: 10, width: 100, height: 100 })).toEqual({
      left: 50,
      top: 0,
      width: 250,
      height: 110,
    });
    expect(union(box, box)).toEqual(box);
  });

  it('rounds to the integer rect the shell hit-tests with', () => {
    expect(toShapeRect({ left: 99.5, top: 0.4, width: 200.49, height: 31.6 })).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 32,
    });
  });

  it('anchors a box by its top-centre', () => {
    expect(anchoredBox(500, 8, 200, 32)).toEqual({ left: 400, top: 8, width: 200, height: 32 });
  });
});

describe('SpeedTracker', () => {
  it('reports px/s between consecutive samples and 0 for the first', () => {
    const tracker = new SpeedTracker();
    expect(tracker.observe({ x: 0, y: 0 }, 1000)).toBe(0);
    expect(tracker.observe({ x: 30, y: 40 }, 1050)).toBe(1000);
    expect(tracker.observe({ x: 30, y: 40 }, 1100)).toBe(0);
  });

  it('ignores coalesced samples closer than 4 ms and keeps the last speed', () => {
    const tracker = new SpeedTracker();
    tracker.observe({ x: 0, y: 0 }, 0);
    expect(tracker.observe({ x: 100, y: 0 }, 100)).toBe(1000);
    expect(tracker.observe({ x: 500, y: 0 }, 102)).toBe(1000);
    // The next real sample measures from the last accepted one (t = 100, x = 100).
    expect(tracker.observe({ x: 200, y: 0 }, 200)).toBe(1000);
  });

  it('starts from zero after the pointer rested for more than 200 ms, and on reset', () => {
    const tracker = new SpeedTracker();
    tracker.observe({ x: 0, y: 0 }, 0);
    expect(tracker.observe({ x: 1000, y: 0 }, 300)).toBe(0);
    tracker.observe({ x: 1100, y: 0 }, 350);
    tracker.reset();
    expect(tracker.observe({ x: 5000, y: 0 }, 360)).toBe(0);
  });
});
