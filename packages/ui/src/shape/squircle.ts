/**
 * Continuous ("squircle") corners, docs/05-design-system.md#shape.
 *
 * Feature-detect `corner-shape: squircle` (CSS Borders 4); otherwise generate a Figma-style
 * smoothed path with the figma-squircle algorithm and apply it as `clip-path: path()`. The path
 * is a function of the rendered size, so it is regenerated only when a surface comes to rest —
 * never per animation frame (morphs run with plain `border-radius`).
 *
 * The Rust hit-test rects must use the same geometry; the notch outline points are exported
 * from `./notch-path` for that purpose.
 */
import { getSvgPath } from 'figma-squircle';

/** Figma "corner smoothing" for every squircle in Muna. */
export const CORNER_SMOOTHING = 0.6;

export interface CornerRadii {
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
}

export interface SquirclePathOptions {
  readonly width: number;
  readonly height: number;
  /** One radius for all corners, or one per corner (0 = square). */
  readonly radius: number | CornerRadii;
  /** Defaults to `CORNER_SMOOTHING`. */
  readonly smoothing?: number;
}

const toCornerRadii = (radius: number | CornerRadii): CornerRadii =>
  typeof radius === 'number'
    ? { topLeft: radius, topRight: radius, bottomRight: radius, bottomLeft: radius }
    : radius;

/** Largest radius that fits: no corner may exceed half the shorter side. */
const clampRadii = (radii: CornerRadii, width: number, height: number): CornerRadii => {
  const max = Math.max(0, Math.min(width, height) / 2);
  const clamp = (r: number) => Math.min(Math.max(0, r), max);
  return {
    topLeft: clamp(radii.topLeft),
    topRight: clamp(radii.topRight),
    bottomRight: clamp(radii.bottomRight),
    bottomLeft: clamp(radii.bottomLeft),
  };
};

/** SVG path data for a smoothed rounded rectangle at the given pixel size. */
export const squirclePath = ({
  width,
  height,
  radius,
  smoothing = CORNER_SMOOTHING,
}: SquirclePathOptions): string => {
  if (width <= 0 || height <= 0) return '';
  const radii = clampRadii(toCornerRadii(radius), width, height);
  return getSvgPath({
    width,
    height,
    topLeftCornerRadius: radii.topLeft,
    topRightCornerRadius: radii.topRight,
    bottomRightCornerRadius: radii.bottomRight,
    bottomLeftCornerRadius: radii.bottomLeft,
    cornerSmoothing: smoothing,
    preserveSmoothing: true,
  });
};

/** `clip-path` value for `squirclePath`, or `none` when the size is not known yet. */
export const squircleClipPath = (options: SquirclePathOptions): string => {
  const path = squirclePath(options);
  return path === '' ? 'none' : `path("${path}")`;
};

let cornerShapeSupport: boolean | undefined;

/**
 * Whether the engine understands `corner-shape: squircle`, in which case `border-radius`
 * alone produces continuous corners and no clip-path is needed. Memoised; `false` without a DOM.
 */
export const supportsCornerShape = (): boolean => {
  cornerShapeSupport ??=
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('corner-shape', 'squircle');
  return cornerShapeSupport;
};

/** Test seam: forget the memoised `corner-shape` detection. */
export const resetCornerShapeSupport = (): void => {
  cornerShapeSupport = undefined;
};
