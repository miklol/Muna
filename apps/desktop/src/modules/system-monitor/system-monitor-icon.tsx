import { Activity } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Activity` at whatever size the shell asks for. */
export function SystemMonitorIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Activity size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
