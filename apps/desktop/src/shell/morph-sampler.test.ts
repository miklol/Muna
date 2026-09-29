import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SAMPLE_MS, MorphSampler } from './morph-sampler';

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
