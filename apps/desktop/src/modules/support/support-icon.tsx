import { LifeBuoy } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `LifeBuoy` at whatever size the shell asks for. */
export function SupportIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <LifeBuoy size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
