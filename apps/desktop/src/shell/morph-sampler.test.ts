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

  it('stops requesting frames by itself once a sample outlives any real morph', () => {
    const sampler = new MorphSampler();
    sampler.start();
    frame(16);
    expect(pending).not.toBeNull();
    frame(MAX_SAMPLE_MS);
    expect(pending).toBeNull();
    // The report is still available to whoever stops the sample later.
    expect(sampler.stop(false)?.frames).toBe(2);
  });
});
