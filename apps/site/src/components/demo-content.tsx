import type { StripSlotContent } from '@muna/ui/primitives';
import { BatteryLow, CalendarClock, Music, Timer } from 'lucide-react';
import type { ReactNode } from 'react';

/** Lucide stroke used across Muna (docs/05-design-system.md#iconography). */
export const ICON_STROKE = 1.5;

export type DemoActivity = 'media' | 'timer' | 'battery' | 'calendar';

export type DemoModule = 'media' | 'pomodoro' | 'todo';

export type DemoShape = 'notch' | 'island';

/** A fictional track for the demo; the artwork is drawn below, so nothing is licensed. */
export const track = {
  title: 'Midnight Drive',
  artist: 'The Lanterns',
  album: 'Night Signals',
  durationMs: 4 * 60_000 + 20_000,
  positionMs: 1 * 60_000 + 52_000,
  palette: ['#2b1d5c', '#e0665c', '#f5c26b'] as const,
} as const;

/** Muna's own artwork: a dusk gradient, a road line and a moon, as an SVG data URL. */
export const albumArtSrc = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">` +
    `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${track.palette[0]}"/>` +
    `<stop offset="0.7" stop-color="${track.palette[1]}"/>` +
    `<stop offset="1" stop-color="${track.palette[2]}"/></linearGradient></defs>` +
    `<rect width="120" height="120" fill="url(#sky)"/>` +
    `<circle cx="84" cy="38" r="16" fill="#fff4d6" opacity="0.92"/>` +
    `<path d="M0 120 L50 76 H70 L120 120 Z" fill="#160f33"/>` +
    `<path d="M58 84 L60 120" stroke="#f5c26b" stroke-width="2" stroke-dasharray="6 6"/>` +
    `</svg>`,
)}`;

/** The pomodoro the timer form shows, 24:37 into a 25 min block. */
export const pomodoro = {
  totalMs: 25 * 60_000,
  remainingMs: 24 * 60_000 + 37_000,
} as const;

export const battery = { percent: 18 } as const;

export const nextEvent = { title: 'Design review', inMinutes: 12 } as const;

export interface ActivityForm {
  readonly id: DemoActivity;
  readonly label: string;
  readonly icon: ReactNode;
  readonly kind: 'activity' | 'notice';
  /** The module the panel opens on for this activity. */
  readonly module: DemoModule;
  readonly description: string;
  readonly leading: (live: boolean, receivedAt: number) => StripSlotContent;
  readonly trailing: (live: boolean, receivedAt: number) => StripSlotContent;
}

const mediaForm: ActivityForm = {
  id: 'media',
  label: 'Media',
  icon: <Music strokeWidth={ICON_STROKE} />,
  kind: 'activity',
  module: 'media',
  description: `Playing ${track.title} by ${track.artist}`,
  leading: () => ({ kind: 'image', src: albumArtSrc, tint: track.palette[1] }),
  trailing: (live) => ({ kind: 'waveform', playing: live }),
};

/** What the strip shows in each form the visitor can pick. */
export const activityForms: readonly ActivityForm[] = [
  mediaForm,
  {
    id: 'timer',
    label: 'Timer',
    icon: <Timer strokeWidth={ICON_STROKE} />,
    kind: 'activity',
    module: 'pomodoro',
    description: 'Pomodoro, 24 minutes left',
    leading: () => ({ kind: 'icon', icon: <Timer strokeWidth={ICON_STROKE} />, tint: 'orange' }),
    trailing: (live, receivedAt) => ({
      kind: 'timer',
      remainingMs: pomodoro.remainingMs,
      totalMs: pomodoro.totalMs,
      running: live,
      receivedAt,
    }),
  },
  {
    id: 'battery',
    label: 'Battery',
    icon: <BatteryLow strokeWidth={ICON_STROKE} />,
    kind: 'notice',
    module: 'todo',
    description: `Battery at ${battery.percent} percent`,
    leading: () => ({ kind: 'battery', percent: battery.percent, charging: false }),
    trailing: () => ({ kind: 'text', value: `${battery.percent}%` }),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: <CalendarClock strokeWidth={ICON_STROKE} />,
    kind: 'activity',
    module: 'todo',
    description: `${nextEvent.title} in ${nextEvent.inMinutes} minutes`,
    leading: () => ({
      kind: 'icon',
      icon: <CalendarClock strokeWidth={ICON_STROKE} />,
      tint: 'blue',
    }),
    trailing: () => ({ kind: 'text', value: `${nextEvent.inMinutes} min` }),
  },
];

export const activityForm = (id: DemoActivity): ActivityForm =>
  activityForms.find((form) => form.id === id) ?? mediaForm;
