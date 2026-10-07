import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SAMPLE_MS, MorphSampler, SNAP_MIN_MS } from './morph-sampler';

// Deterministic frame loop: `frame(ms)` runs the pending callback at that timestamp.
let pending: FrameRequestCallback | null = null;
let now = 0;

beforeEach(() => {
  pending = null;
  now = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
    pending = callback;
    return 1;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
    pending = null;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const frame = (ms: number): void => {
  const callback = pending;
  pending = null;
  now = ms;
  callback?.(ms);
};

// A frame run at `ms` that rAF stamps with the earlier time it began, `stamp`.
const lateFrame = (stamp: number, ms: number): void => {
  const callback = pending;
  pending = null;
  now = ms;
  callback?.(stamp);
};

describe('MorphSampler', () => {
  it('counts frames, the longest gap and dropped frames between start and stop', () => {
    const sampler = new MorphSampler();
    sampler.start();
    expect(sampler.active).toBe(true);
    frame(16);
    frame(32);
    frame(72); // 40 ms gap: dropped
    const report = sampler.stop(true);
    expect(report).toEqual({
      expanded: true,
      frames: 3,
      durationUs: 72_000,
      maxFrameUs: 40_000,
      droppedFrames: 1,
    });
    expect(sampler.active).toBe(false);
    expect(pending).toBeNull();
  });

  it('returns null when nothing was sampled', () => {
    expect(new MorphSampler().stop()).toBeNull();
  });

  it('reports a tween that a long task swallowed before its first frame, with its wall time', () => {
    const sampler = new MorphSampler();
    now = 1000;
    sampler.start();
    // Motion completed the morph in the frame turn the sampler's first callback would have run.
    now = 1180;
    expect(sampler.stop(true)).toEqual({
      expanded: true,
      frames: 0,
      durationUs: 180_000,
      maxFrameUs: 180_000,
      droppedFrames: 0,
    });
    expect(pending).toBeNull();
  });

  it('drops a frameless morph that was instant or cut short', () => {
    const sampler = new MorphSampler();
    // Reduced motion snaps the layout values: nothing tweens, however long the frame took.
    sampler.start(false);
    now = 400;
    expect(sampler.stop(false)).toBeNull();
    // A tween ended within one frame of starting: a new target cut it short.
    now = 1000;
    sampler.start();
    now = 1000 + SNAP_MIN_MS - 1;
    expect(sampler.stop(true)).toBeNull();
    expect(sampler.active).toBe(false);
    // From SNAP_MIN_MS on, a frameless tween is a stall and is reported.
    sampler.start();
    now += SNAP_MIN_MS;
    expect(sampler.stop(true)).toEqual(expect.objectContaining({ frames: 0, durationUs: 20000 }));
  });

  it('keeps timing a sampled morph from its start to its last frame', () => {
    const sampler = new MorphSampler();
    sampler.start(false);
    frame(16);
    frame(33);
    // Completion lands after the last counted frame; the span stays the frames' own.
    now = 45;
    expect(sampler.stop(false)).toMatchObject({ frames: 2, durationUs: 33_000 });
  });

  it('times a morph whose only frame began before its start by the wall, never negatively (#75)', () => {
    const sampler = new MorphSampler();
    now = 1000;
    sampler.start();
    // The morph started inside a long task after this frame was due: rAF stamps the frame with
    // the time it began, 66 ms before `start`, and runs it once the task ends.
    lateFrame(934, 1010);
    now = 1200;
    const report = sampler.stop(false);
    expect(report).toEqual({
      expanded: false,
      frames: 1,
      durationUs: 200_000,
      maxFrameUs: 200_000,
      droppedFrames: 0,
    });
    // The shell's report fields are unsigned: a negative span is rejected and never logged.
    for (const value of Object.values(report ?? {})) {
      if (typeof value === 'number') {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
    // A later frame gives the sample a span of its own again: frame timing is unchanged.
    sampler.start();
    lateFrame(1195, 1210);
    frame(1217);
    now = 1230;
    expect(sampler.stop(false)).toMatchObject({
      frames: 2,
      durationUs: 17_000,
      maxFrameUs: 22_000,
    });
  });

  it('stops requesting frames by itself once a sample outlives any real morph', () => {
    const sampler = new MorphSampler();
    sampler.start();
    frame(16);
    expect(pending).not.toBeNull();
    frame(MAX_SAMPLE_MS);
    expect(pending).toBeNull();
    expect(sampler.active).toBe(false);
    // The report is still available to whoever stops the sample later.
    expect(sampler.stop(false)?.frames).toBe(2);
  });
});
