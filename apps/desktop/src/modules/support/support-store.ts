import type { SupportSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface SupportStore {
  /** Last `SupportChanged` (or the answer to `getSupportSnapshot`); `null` until the first arrives. */
  snapshot: SupportSnapshot | null;
  setSnapshot: (snapshot: SupportSnapshot) => void;
}

/**
 * The support module's mirror of the Rust service (docs/modules/support.md). Fed by
 * `useSupportSubscription` while the panel or the settings pane is mounted; nothing polls. The
 * snapshot is small — a version, a channel, the machine, the log size, the last bundle — so the
 * whole thing is replaced on every change.
 */
export const useSupportStore = create<SupportStore>()((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
}));
