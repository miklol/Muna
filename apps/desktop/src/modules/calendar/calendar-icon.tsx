import { Calendar } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Calendar` at whatever size the shell asks for. */
export function CalendarIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Calendar size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
