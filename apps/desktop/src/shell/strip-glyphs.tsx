import type { Glyph } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import {
  Archive,
  Battery,
  BatteryCharging,
  Bell,
  Bluetooth,
  Calendar,
  CircleCheck,
  CircleX,
  Cpu,
  Folder,
  GitPullRequest,
  HardDrive,
  Headphones,
  Hourglass,
  Inbox,
  Lock,
  LockOpen,
  Mic,
  MicOff,
  Moon,
  Music,
  Play,
  Share2,
  Sun,
  Timer,
  Trash2,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
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

/** The `strip.glyph.*` keys, narrow enough for i18next's typed `t` to resolve cheaply. */
export type GlyphLabelKey = Extract<MessageKey, `strip.glyph.${string}`>;

/** What a screen reader hears for a glyph alone (`strip.glyph.*` in the catalog). */
export const glyphLabelKey: Readonly<Record<Glyph, GlyphLabelKey>> = {
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
  volume: 'strip.glyph.volume',
  volumeLow: 'strip.glyph.volumeLow',
  volumeMedium: 'strip.glyph.volumeMedium',
  volumeHigh: 'strip.glyph.volumeHigh',
  volumeMuted: 'strip.glyph.volumeMuted',
  sun: 'strip.glyph.sun',
  mic: 'strip.glyph.mic',
  micMuted: 'strip.glyph.micMuted',
  checkCircle: 'strip.glyph.checkCircle',
  cpu: 'strip.glyph.cpu',
  hourglass: 'strip.glyph.hourglass',
  calendar: 'strip.glyph.calendar',
  folder: 'strip.glyph.folder',
  archive: 'strip.glyph.archive',
  share: 'strip.glyph.share',
  trash: 'strip.glyph.trash',
  drive: 'strip.glyph.drive',
  shelf: 'strip.glyph.shelf',
  pullRequest: 'strip.glyph.pullRequest',
  xCircle: 'strip.glyph.xCircle',
};

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
    case 'volume':
      return <Volume {...glyphProps} />;
    case 'volumeLow':
      return <Volume1 {...glyphProps} />;
    case 'volumeMedium':
    case 'volumeHigh':
      // Lucide stops at two waves; the level track beside the glyph carries the rest.
      return <Volume2 {...glyphProps} />;
    case 'volumeMuted':
      return <VolumeX {...glyphProps} />;
    case 'sun':
      return <Sun {...glyphProps} />;
    case 'mic':
      return <Mic {...glyphProps} />;
    case 'micMuted':
      return <MicOff {...glyphProps} />;
    case 'checkCircle':
      return <CircleCheck {...glyphProps} />;
    case 'cpu':
      return <Cpu {...glyphProps} />;
    case 'hourglass':
      return <Hourglass {...glyphProps} />;
    case 'calendar':
      return <Calendar {...glyphProps} />;
    case 'folder':
      return <Folder {...glyphProps} />;
    case 'archive':
      return <Archive {...glyphProps} />;
    case 'share':
      return <Share2 {...glyphProps} />;
    case 'trash':
      return <Trash2 {...glyphProps} />;
    case 'drive':
      return <HardDrive {...glyphProps} />;
    case 'shelf':
      return <Inbox {...glyphProps} />;
    case 'pullRequest':
      return <GitPullRequest {...glyphProps} />;
    case 'xCircle':
      return <CircleX {...glyphProps} />;
  }
};
