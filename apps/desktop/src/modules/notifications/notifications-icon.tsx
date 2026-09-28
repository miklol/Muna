import { Bell } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Bell` at whatever size the shell asks for. */
export function NotificationsIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Bell size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
