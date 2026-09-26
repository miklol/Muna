import { FolderInput } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The settings rail glyph: Lucide `FolderInput` at whatever size the shell asks for. */
export function DropActionsIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <FolderInput size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
