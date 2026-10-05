import type { MorphReport } from '@muna/contracts';

const FRAME_MS = 1000 / 60;
const DROPPED_FRAME_FACTOR = 1.5;
/**
 * No morph runs this long (the slowest spring settles well under a second); a sample still
 * open after this is a missed completion, and the loop must not keep the renderer awake
 * (idle CPU budget, docs/01-product-vision.md).
 */
export const MAX_SAMPLE_MS = 5000;
/**
 * A morph meant to tween that completes before the sampler's first frame was swallowed by a
 * long task when it took at least one 60 Hz frame plus slack; quicker, it was cut short (a
 * new target arrived) and says nothing about frame rate. The sampler does not know the
 * display's refresh, hence the fixed 20 ms; a 120 or 240 Hz frame is shorter still.
 */
export const SNAP_MIN_MS = 20;

interface Sample {
  start: number;
  last: number;
  frames: number;
  maxFrameMs: number;
  droppedFrames: number;
  raf: number;
  tweens: boolean;
}

/**
 * Counts animation frames while a morph is in flight so the shell can log fps evidence
 * (docs/09-testing-qa.md, performance harness). The loop runs only between `start` and
 * `stop`, and gives up by itself after [`MAX_SAMPLE_MS`]; nothing ticks at rest.
 */
export class MorphSampler {
  #sample: Sample | null = null;

  /**
   * `tweens` is `false` for a morph Motion applies at once — under reduced motion one that
   * moves only the layout values, which snap — so a frameless report of it is not a stall.
   */
  start(tweens = true): void {
    this.stop();
    const now = performance.now();
    const sample: Sample = {
      start: now,
      last: now,
      frames: 0,
      maxFrameMs: 0,
      droppedFrames: 0,
      raf: 0,
      tweens,
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

  /**
   * Stops sampling and returns the report, or `null` when nothing was being sampled or the
   * morph spanned no frame and was not a stalled tween (an instant morph, a cut-short one).
   *
   * A sampled morph lasts from `start` to its last frame, the span the frames were counted
   * in. A tween that completed before the first frame — one long task (a cold panel mount)
   * swallowed it whole — is reported with `frames: 0` and its wall duration, so the log
   * reads `fps=0` instead of saying nothing (#71).
   */
  stop(expanded = false): MorphReport | null {
    const sample = this.#sample;
    if (sample === null) {
      return null;
    }
    cancelAnimationFrame(sample.raf);
    this.#sample = null;
    const wallMs = performance.now() - sample.start;
    if (sample.frames === 0 && (!sample.tweens || wallMs < SNAP_MIN_MS)) {
      return null;
    }
    const durationMs = sample.frames === 0 ? wallMs : sample.last - sample.start;
    return {
      expanded,
      frames: sample.frames,
      durationUs: Math.round(durationMs * 1000),
      maxFrameUs: Math.round((sample.frames === 0 ? wallMs : sample.maxFrameMs) * 1000),
      droppedFrames: sample.droppedFrames,
    };
  }

  /**
   * Whether a morph is being sampled. A sample older than [`MAX_SAMPLE_MS`] is a missed
   * completion, not a morph in flight, so a new morph does not continue it.
   */
  get active(): boolean {
    const sample = this.#sample;
    return sample !== null && performance.now() - sample.start < MAX_SAMPLE_MS;
  }
}
