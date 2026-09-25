import { Music } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Music` at whatever size the shell asks for. */
export function MediaIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Music size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
