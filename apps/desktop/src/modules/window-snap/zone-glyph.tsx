import type { GlyphRect } from './zones';

/** The glyph's drawing area inside its 28 × 18 viewBox: a screen outline with a 2 px margin. */
const FRAME = { x: 2, y: 2, width: 24, height: 14 } as const;
/** Breathing room between the highlighted zone and the outline, and between neighbours. */
const INSET = 0.75;

export interface ZoneGlyphProps {
  readonly rect: GlyphRect;
  readonly size?: number;
}

/**
 * A screen outline with the zone filled in (docs/modules/window-snap.md "Reference": layout
 * glyph tiles). Both draw in `currentColor`, so the tile's text colour carries through; the
 * outline sits at half strength so the zone reads first.
 */
export function ZoneGlyph({ rect, size = 28 }: ZoneGlyphProps) {
  const height = (size * 18) / 28;
  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 28 18"
      aria-hidden
      focusable={false}
      className="snap-glyph"
    >
      <rect
        x={FRAME.x - 1}
        y={FRAME.y - 1}
        width={FRAME.width + 2}
        height={FRAME.height + 2}
        rx={2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        opacity={0.45}
      />
      <rect
        x={FRAME.x + rect.x * FRAME.width + INSET}
        y={FRAME.y + rect.y * FRAME.height + INSET}
        width={Math.max(0, rect.width * FRAME.width - 2 * INSET)}
        height={Math.max(0, rect.height * FRAME.height - 2 * INSET)}
        rx={1}
        fill="currentColor"
      />
    </svg>
  );
}
