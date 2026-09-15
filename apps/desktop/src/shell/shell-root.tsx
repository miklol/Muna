import { commands } from '@muna/contracts';
import { useQuery } from '@tanstack/react-query';

import { NotchWindow } from './notch-window';
import { SpikeWindow } from './spike-window';

/**
 * Picks the UI for the notch window. Rust decides the mode from the environment
 * (`MUNA_SPIKE=window`, docs/spikes/m0-window.md); outside Tauri the query fails and the
 * product shell renders.
 */
export function ShellRoot() {
  const mode = useQuery({
    queryKey: ['shell-mode'],
    queryFn: () => commands.getShellMode(),
  });

  if (mode.isPending) {
    // Paint nothing until the mode is known so the first visible frame is the right shell.
    return null;
  }
  return mode.data === 'spikeWindow' ? <SpikeWindow /> : <NotchWindow />;
}
