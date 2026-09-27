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

/** Speaker body shared by the volume glyphs (docs/modules/hud.md: speaker with 0–3 waves). */
const speaker = 'M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z';

export const VolumeGlyph = ({ waves = 0 }: { waves?: 0 | 1 | 2 | 3 }) => (
  <svg {...base}>
    <path d={speaker} />
    {waves >= 1 && <path d="M10.2 6.5a2.2 2.2 0 0 1 0 3" />}
    {waves >= 2 && <path d="M11.8 5a4.4 4.4 0 0 1 0 6" />}
    {waves >= 3 && <path d="M13.3 3.6a6.5 6.5 0 0 1 0 8.8" />}
  </svg>
);

export const VolumeMutedGlyph = () => (
  <svg {...base}>
    <path d={speaker} />
    <path d="M10.5 6.5l3 3M13.5 6.5l-3 3" />
  </svg>
);

export const SunGlyph = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="2.6" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
);

export const TerminalGlyph = () => (
  <svg {...base}>
    <path d="M3 4.5l3.5 3.5L3 11.5M8 12h5" />
  </svg>
);
