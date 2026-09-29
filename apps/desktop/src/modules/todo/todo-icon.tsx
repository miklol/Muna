import { ListChecks } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `ListChecks` at whatever size the shell asks for. */
export function TodoIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <ListChecks size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
