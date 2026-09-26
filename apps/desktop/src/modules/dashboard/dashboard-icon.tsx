import { LayoutGrid } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `LayoutGrid` at whatever size the shell asks for. */
export function DashboardIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <LayoutGrid size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
