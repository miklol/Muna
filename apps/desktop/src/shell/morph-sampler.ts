import type { MorphReport } from '@muna/contracts';

const FRAME_MS = 1000 / 60;
const DROPPED_FRAME_FACTOR = 1.5;

interface Sample {
  start: number;
  last: number;
  frames: number;
  maxFrameMs: number;
  droppedFrames: number;
  raf: number;
}

/**
 * Counts animation frames while a morph is in flight so the shell can log fps evidence
 * (docs/09-testing-qa.md, performance harness). The loop runs only between `start` and
 * `stop`; nothing ticks at rest.
 */
export class MorphSampler {
  #sample: Sample | null = null;

  start(): void {
    this.stop();
    const now = performance.now();
    const sample: Sample = {
      start: now,
      last: now,
      frames: 0,
      maxFrameMs: 0,
      droppedFrames: 0,
      raf: 0,
    };
    const tick = (time: number) => {
      const delta = time - sample.last;
      sample.last = time;
      sample.frames += 1;
      sample.maxFrameMs = Math.max(sample.maxFrameMs, delta);
      if (delta > FRAME_MS * DROPPED_FRAME_FACTOR) {
        sample.droppedFrames += 1;
      }
      sample.raf = requestAnimationFrame(tick);
    };
    sample.raf = requestAnimationFrame(tick);
    this.#sample = sample;
  }

  /** Stops sampling and returns the report, or `null` when nothing was being sampled. */
  stop(expanded = false): MorphReport | null {
    const sample = this.#sample;
    if (sample === null) {
      return null;
    }
    cancelAnimationFrame(sample.raf);
    this.#sample = null;
    return {
      expanded,
      frames: sample.frames,
      durationUs: Math.round((sample.last - sample.start) * 1000),
      maxFrameUs: Math.round(sample.maxFrameMs * 1000),
      droppedFrames: sample.droppedFrames,
    };
  }

  get active(): boolean {
    return this.#sample !== null;
  }
}
