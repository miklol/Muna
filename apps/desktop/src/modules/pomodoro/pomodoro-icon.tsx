import { Timer } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Timer` at whatever size the shell asks for. */
export function PomodoroIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Timer size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
