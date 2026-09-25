import type { MorphReport } from '@muna/contracts';

const FRAME_MS = 1000 / 60;
const DROPPED_FRAME_FACTOR = 1.5;
/**
 * No morph runs this long (the slowest spring settles well under a second); a sample still
 * open after this is a missed completion, and the loop must not keep the renderer awake
 * (idle CPU budget, docs/01-product-vision.md).
 */
export const MAX_SAMPLE_MS = 5000;

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
 * `stop`, and gives up by itself after [`MAX_SAMPLE_MS`]; nothing ticks at rest.
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
      // A completion that never arrives (the shell parked and unmounted mid-morph) must not
      // leave a frame loop running; the report stays available until `stop`.
      sample.raf = time - sample.start >= MAX_SAMPLE_MS ? 0 : requestAnimationFrame(tick);
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
