import { Terminal } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `Terminal` at whatever size the shell asks for. */
export function AiCodingIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <Terminal size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
