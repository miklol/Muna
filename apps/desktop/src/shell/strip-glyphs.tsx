import type { Glyph } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  AudioLines,
  Battery,
  BatteryCharging,
  Bell,
  Bluetooth,
  Headphones,
  Lock,
  LockOpen,
  Moon,
  Music,
  Play,
  Timer,
} from 'lucide-react';
import type { ReactNode } from 'react';

/** Strip slot glyph size and stroke (docs/05-design-system.md "Iconography": 20 px, 1.5). */
const GLYPH_SIZE = 20;
const GLYPH_STROKE = 1.5;

const glyphProps = {
  size: GLYPH_SIZE,
  strokeWidth: GLYPH_STROKE,
  'aria-hidden': true,
  focusable: false,
} as const;

/** What a screen reader hears for a glyph alone (`strip.glyph.*` in the catalog). */
export const glyphLabelKey: Readonly<Record<Glyph, MessageKey>> = {
  battery: 'strip.glyph.battery',
  batteryCharging: 'strip.glyph.batteryCharging',
  bluetooth: 'strip.glyph.bluetooth',
  headphones: 'strip.glyph.headphones',
  lock: 'strip.glyph.lock',
  unlock: 'strip.glyph.unlock',
  timer: 'strip.glyph.timer',
  bell: 'strip.glyph.bell',
  music: 'strip.glyph.music',
  moon: 'strip.glyph.moon',
  play: 'strip.glyph.play',
};

/**
 * Stands in for the media module's audio bars until the animated primitive lands with the
 * media UI (docs/build-plan/m2-media-hud.md, E2). Static so it costs nothing while playing.
 */
export const waveformGlyph = (): ReactNode => <AudioLines {...glyphProps} />;

/**
 * The contract's closed glyph set drawn with Lucide. Exhaustive on purpose: adding a `Glyph`
 * variant in Rust fails the typecheck here until it has an icon.
 */
export const stripGlyph = (glyph: Glyph): ReactNode => {
  switch (glyph) {
    case 'battery':
      return <Battery {...glyphProps} />;
    case 'batteryCharging':
      return <BatteryCharging {...glyphProps} />;
    case 'bluetooth':
      return <Bluetooth {...glyphProps} />;
    case 'headphones':
      return <Headphones {...glyphProps} />;
    case 'lock':
      return <Lock {...glyphProps} />;
    case 'unlock':
      return <LockOpen {...glyphProps} />;
    case 'timer':
      return <Timer {...glyphProps} />;
    case 'bell':
      return <Bell {...glyphProps} />;
    case 'music':
      return <Music {...glyphProps} />;
    case 'moon':
      return <Moon {...glyphProps} />;
    case 'play':
      return <Play {...glyphProps} />;
  }
};
