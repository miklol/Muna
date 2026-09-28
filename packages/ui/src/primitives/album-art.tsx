import type { CSSProperties, ReactNode } from 'react';

import './album-art.css';
import { cx } from './shared';

export interface AlbumArtProps {
  /** Artwork URL; `null` while nothing is known (the fallback shows). */
  src: string | null;
  /** Up to three palette swatches (CSS colours) from the artwork, dominant first. */
  palette?: readonly string[];
  /** Whether the palette bleeds into the surface around the art (the "adaptive colours" setting). */
  adaptive?: boolean;
  /** Square size in px; the panel uses 96, cards 40. */
  size?: number;
  /** Shown instead of the image when there is no artwork; usually a 24 px icon. */
  fallback?: ReactNode;
  /** Paused art dims to 60 % (docs/modules/media.md "States"). */
  dimmed?: boolean;
  className?: string;
}

/** CSS custom properties carrying the palette: `--media-accent-1..3`, dominant first. */
export const paletteVars = (palette: readonly string[]): CSSProperties => {
  const vars: Record<string, string> = {};
  palette.slice(0, 3).forEach((colour, index) => {
    vars[`--media-accent-${String(index + 1)}`] = colour;
  });
  return vars;
};

/**
 * Album art (docs/modules/media.md "Adaptive colours", docs/build-plan/m2-media-hud.md E2):
 * a rounded square with the artwork's palette published as `--media-accent-1..3` and, when
 * `adaptive`, bled into the surface behind it at no more than 30 % — never onto text. The image
 * is decorative; the track title beside it carries the meaning.
 */
export function AlbumArt({
  src,
  palette = [],
  adaptive = true,
  size = 96,
  fallback,
  dimmed = false,
  className,
}: AlbumArtProps) {
  const tinted = adaptive && palette.length > 0;
  return (
    <span
      className={cx('muna-album-art', className)}
      data-tinted={tinted || undefined}
      data-dimmed={dimmed || undefined}
      style={{ ...paletteVars(palette), inlineSize: size, blockSize: size }}
    >
      {src === null ? (
        <span aria-hidden="true" className="muna-album-art__fallback">
          {fallback}
        </span>
      ) : (
        <img className="muna-album-art__image" src={src} alt="" draggable={false} />
      )}
    </span>
  );
}
