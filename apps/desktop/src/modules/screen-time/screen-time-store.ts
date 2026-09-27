import type { ScreenTimeSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface ScreenTimeStore {
  /** Last `ScreenTimeChanged` (or the answer to `getScreenTimeSnapshot`); `null` until then. */
  snapshot: ScreenTimeSnapshot | null;
  /** `Date.now()` when `snapshot` arrived. */
  receivedAt: number;
  setSnapshot: (snapshot: ScreenTimeSnapshot, at?: number) => void;
}

/**
 * The screen time module's mirror of the Rust tracker (docs/modules/screen-time.md). Fed by
 * `useScreenTimeSubscription` while the panel, the widget or the settings pane is mounted;
 * Rust publishes only while something watches, so a closed panel costs nothing. Nothing here
 * ticks: the "since" and the totals are the snapshot's, refreshed with every tick Rust sends.
 */
export const useScreenTimeStore = create<ScreenTimeStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  setSnapshot: (snapshot, at = Date.now()) => {
    set({ snapshot, receivedAt: at });
  },
}));
