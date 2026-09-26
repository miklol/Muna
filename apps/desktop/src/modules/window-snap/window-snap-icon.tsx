import { LayoutTemplate } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module glyph: Lucide `LayoutTemplate` (a screen split into zones). */
export function WindowSnapIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <LayoutTemplate size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
