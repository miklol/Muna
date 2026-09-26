import { Keyboard } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The settings rail glyph: Lucide `Keyboard` at whatever size the shell asks for. */
export function KeyboardShortcutsIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Keyboard size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
