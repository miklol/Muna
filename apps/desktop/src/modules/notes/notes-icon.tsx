import { StickyNote } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `StickyNote` at whatever size the shell asks for. */
export function NotesIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <StickyNote size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
