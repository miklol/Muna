import { GitPullRequest } from 'lucide-react';

import type { ModuleIconProps } from '../registry';

/** The module bar glyph: Lucide `GitPullRequest` at whatever size the shell asks for. */
export function CodeHostingIcon({ size = 20, strokeWidth = 1.5 }: ModuleIconProps) {
  return <GitPullRequest size={size} strokeWidth={strokeWidth} aria-hidden focusable={false} />;
}
