import { Volume2 } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The settings rail glyph: Lucide `Volume2` at whatever size the shell asks for. */
export function HudIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Volume2 size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
