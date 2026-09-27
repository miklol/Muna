import { Hourglass } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Hourglass` at whatever size the shell asks for. */
export function ScreenTimeIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Hourglass size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
