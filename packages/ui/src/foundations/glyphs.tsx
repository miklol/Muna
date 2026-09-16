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

export const CalendarGlyph = () => (
  <svg {...base}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
    <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
  </svg>
);

export const BatteryGlyph = () => (
  <svg {...base}>
    <rect x="2" y="5" width="10.5" height="6" rx="1.5" />
    <path d="M14 7v2M4 7.5v1" />
  </svg>
);

export const BellGlyph = () => (
  <svg {...base}>
    <path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3z" />
    <path d="M6.5 14a1.5 1.5 0 0 0 3 0" />
  </svg>
);

export const GridGlyph = () => (
  <svg {...base}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </svg>
);

export const InboxGlyph = () => (
  <svg {...base}>
    <path d="M2.5 9h3l1 2h3l1-2h3" />
    <path d="M4 3.5h8l1.5 5.5v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V9z" />
  </svg>
);

export const PinGlyph = () => (
  <svg {...base}>
    <path d="M9.5 2.5l4 4-1.5 1.5-.5-.5-2.5 2.5v3l-1 1-2.5-2.5L3 14l-1-1 2.5-2.5L2 8l1-1h3l2.5-2.5-.5-.5z" />
  </svg>
);

export const CollapseGlyph = () => (
  <svg {...base}>
    <path d="M9.5 6.5L14 2M9.5 6.5V3M9.5 6.5H13M6.5 9.5L2 14M6.5 9.5V13M6.5 9.5H3" />
  </svg>
);

export const AlertGlyph = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="6" />
    <path d="M8 5v3.5M8 11h.01" />
  </svg>
);
