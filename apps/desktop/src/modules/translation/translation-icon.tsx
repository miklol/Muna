import { Languages } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide's languages. */
export function TranslationIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Languages size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
