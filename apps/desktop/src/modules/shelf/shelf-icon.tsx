import { Inbox } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Inbox` (a tray) at whatever size the shell asks for. */
export function ShelfIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Inbox size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
