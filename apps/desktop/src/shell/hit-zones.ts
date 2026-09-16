import type { ShapeRect } from '@muna/contracts';
import { timings } from '@muna/ui/motion';

/** Axis-aligned box in CSS px, window client coordinates (what `getBoundingClientRect` gives). */
export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

export const contains = (box: Box, point: Point): boolean =>
  point.x >= box.left &&
  point.x < box.left + box.width &&
  point.y >= box.top &&
  point.y < box.top + box.height;

/** The box grown by the extended hover padding on every side (docs/06-motion-spec.md). */
export const padded = (box: Box, padding: number = timings.hoverPaddingPx): Box => ({
  left: box.left - padding,
  top: box.top - padding,
  width: box.width + 2 * padding,
  height: box.height + 2 * padding,
});

/** Smallest box containing both. */
export const union = (a: Box, b: Box): Box => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
};

/** Integer rect for the shell's hit tester. */
export const toShapeRect = (box: Box): ShapeRect => ({
  x: Math.round(box.left),
  y: Math.round(box.top),
  width: Math.round(box.width),
  height: Math.round(box.height),
});

/** A box of `width × height` whose top edge is `top` and whose centre is `centreX`. */
export const anchoredBox = (centreX: number, top: number, width: number, height: number): Box => ({
  left: centreX - width / 2,
  top,
  width,
  height,
});

interface Sample extends Point {
  readonly t: number;
}

/** Pointer samples closer than this are coalesced input, not motion. */
const MIN_SAMPLE_GAP_MS = 4;
/** A gap longer than this means the pointer rested; the next sample starts from zero speed. */
const REST_GAP_MS = 200;

/**
 * Instantaneous pointer speed from consecutive samples, in px/s, for the hover-intent velocity
 * gate. Stateless apart from the previous sample.
 */
export class SpeedTracker {
  #last: Sample | null = null;
  #speed = 0;

  /** Feeds a sample and returns the speed since the previous one (0 for the first). */
  observe(point: Point, t: number): number {
    const last = this.#last;
    if (last !== null && t - last.t < MIN_SAMPLE_GAP_MS) {
      // Coalesced input: keep the previous sample so the next real one measures true motion.
      return this.#speed;
    }
    this.#last = { ...point, t };
    if (last === null || t - last.t > REST_GAP_MS) {
      this.#speed = 0;
    } else {
      this.#speed = (Math.hypot(point.x - last.x, point.y - last.y) / (t - last.t)) * 1000;
    }
    return this.#speed;
  }

  reset(): void {
    this.#last = null;
    this.#speed = 0;
  }
}
