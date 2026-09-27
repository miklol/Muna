import { Camera } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide's camera. */
export function MirrorIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Camera size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
