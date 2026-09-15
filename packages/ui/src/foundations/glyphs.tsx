/**
 * Inline 16 px glyphs for stories only (the product uses Lucide through the icons package,
 * docs/05-design-system.md#iconography). Stroke 1.5, round joins, `currentColor`.
 */
import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
};

export const PlayGlyph = () => (
  <svg {...base}>
    <path d="M4.5 2.8v10.4L12.8 8z" />
  </svg>
);

export const PauseGlyph = () => (
  <svg {...base}>
    <path d="M5 3v10M11 3v10" />
  </svg>
);

export const SkipGlyph = () => (
  <svg {...base}>
    <path d="M3.5 3.2v9.6L10 8zM12.5 3.2v9.6" />
  </svg>
);

export const CloseGlyph = () => (
  <svg {...base}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const MusicGlyph = () => (
  <svg {...base}>
    <path d="M6 12.5V4l6-1.5V11" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="10.5" cy="11" r="1.5" />
  </svg>
);

export const TimerGlyph = () => (
  <svg {...base}>
    <circle cx="8" cy="9" r="5" />
    <path d="M8 6.5V9l1.8 1.2M6.5 2h3" />
  </svg>
);
