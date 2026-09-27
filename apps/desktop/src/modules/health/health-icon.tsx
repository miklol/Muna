import { Heart } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide's heart, the sign the strip uses for the break reminder. */
export function HealthIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Heart size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
