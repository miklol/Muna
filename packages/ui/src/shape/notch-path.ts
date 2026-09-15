/**
 * The Notch silhouette (docs/05-design-system.md#shape, "Notch flare"): the top edge is flush
 * with the screen and flares *outward* into the bezel through two fillets, the bottom corners
 * are rounded inward. One path with four radii — top fillets 6 px collapsed → 19 px expanded,
 * bottom corners 14 → 28 (`--radius-strip` → `--radius-panel`).
 *
 * The path's bounding box is `bodyWidth + 2 · topRadius` wide: the flares sit outside the black
 * body, so a 200 px strip with 6 px fillets occupies 212 px. Corners are exact circular arcs;
 * that keeps the flare tangent to the screen edge and lets the Rust hit-test use the same
 * numbers (`notchOutline`).
 */

export interface NotchPathOptions {
  /** Width of the black body (the strip or panel width), px. */
  readonly width: number;
  /** Full height including the flare, px. */
  readonly height: number;
  /** Top fillet radius (flare into the bezel), px. */
  readonly topRadius: number;
  /** Bottom corner radius, px. */
  readonly bottomRadius: number;
}

/** Notch radii by shell state, from the design system's flare paragraph. */
export const notchRadii = {
  collapsed: { topRadius: 6, bottomRadius: 14 },
  expanded: { topRadius: 19, bottomRadius: 28 },
} as const;

const fmt = (n: number): string => Number(n.toFixed(3)).toString();

/** Clamp the radii so the path stays well-formed at any size. */
const fit = ({ width, height, topRadius, bottomRadius }: NotchPathOptions) => {
  const t = Math.max(0, Math.min(topRadius, height));
  const r = Math.max(0, Math.min(bottomRadius, width / 2, height - t));
  return { w: Math.max(0, width), h: Math.max(0, height), t, r };
};

/** Total width of the silhouette including both flares. */
export const notchOuterWidth = (options: NotchPathOptions): number => {
  const { w, t } = fit(options);
  return w + 2 * t;
};

/**
 * SVG path data for the notch, origin at the top-left of its bounding box
 * (`notchOuterWidth × height`). Usable as `clip-path: path()` or a `<path d>`. Pass
 * `closed: false` for an outline that leaves out the top edge (the panel hairline runs
 * everywhere except along the screen edge).
 */
export const notchPath = (options: NotchPathOptions, { closed = true } = {}): string => {
  const { w, h, t, r } = fit(options);
  if (w <= 0 || h <= 0) return '';
  const right = w + t;
  return [
    'M 0 0',
    `A ${fmt(t)} ${fmt(t)} 0 0 1 ${fmt(t)} ${fmt(t)}`,
    `L ${fmt(t)} ${fmt(h - r)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(t + r)} ${fmt(h)}`,
    `L ${fmt(right - r)} ${fmt(h)}`,
    `A ${fmt(r)} ${fmt(r)} 0 0 0 ${fmt(right)} ${fmt(h - r)}`,
    `L ${fmt(right)} ${fmt(t)}`,
    `A ${fmt(t)} ${fmt(t)} 0 0 1 ${fmt(right + t)} 0`,
    ...(closed ? ['Z'] : []),
  ].join(' ');
};

/** `clip-path` value for `notchPath`, or `none` when the size is not known yet. */
export const notchClipPath = (options: NotchPathOptions): string => {
  const path = notchPath(options);
  return path === '' ? 'none' : `path("${path}")`;
};

export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * The silhouette as a polygon (clockwise from the top-left), each arc sampled into
 * `segments` straight edges. Shared with the Rust hit-test so pointer geometry matches pixels.
 */
export const notchOutline = (options: NotchPathOptions, segments = 8): Point[] => {
  const { w, h, t, r } = fit(options);
  const right = w + t;
  const arc = (cx: number, cy: number, radius: number, from: number, to: number): Point[] => {
    const points: Point[] = [];
    for (let i = 0; i <= segments; i += 1) {
      const a = from + ((to - from) * i) / segments;
      points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
    }
    return points;
  };
  const half = Math.PI / 2;
  return [
    // Top-left flare: centre (0, t), from 12 o'clock to 3 o'clock.
    ...arc(0, t, t, -half, 0),
    // Bottom-left corner: centre (t + r, h − r), from 9 o'clock to 6 o'clock.
    ...arc(t + r, h - r, r, Math.PI, half),
    // Bottom-right corner: centre (right − r, h − r), from 6 o'clock to 3 o'clock.
    ...arc(right - r, h - r, r, half, 0),
    // Top-right flare: centre (right + t, t), from 9 o'clock to 12 o'clock.
    ...arc(right + t, t, t, Math.PI, Math.PI + half),
  ].map(({ x, y }) => ({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) }));
};
