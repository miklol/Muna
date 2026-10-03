import type { SystemMonitorSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface SystemMonitorStore {
  /** Last reading; `null` until the first one arrives. */
  snapshot: SystemMonitorSnapshot | null;
  /** `Date.now()` when `snapshot` arrived. */
  receivedAt: number;
  /**
   * The busiest network moment seen so far, in bytes per second; the network ring draws the
   * current rate against it, since a rate has no natural maximum.
   */
  peakNetworkBytesPerS: number;
  setSnapshot: (snapshot: SystemMonitorSnapshot | null, at?: number) => void;
}

/** Below this the network ring treats the peak as this floor, so a quiet link reads as quiet. */
export const NETWORK_RING_FLOOR_BYTES_PER_S = 128 * 1024;

/** The current transfer rate, both directions summed; `null` until two samples exist. */
export const networkTotal = (snapshot: SystemMonitorSnapshot): number | null =>
  snapshot.networkDownBytesPerS === null || snapshot.networkUpBytesPerS === null
    ? null
    : snapshot.networkDownBytesPerS + snapshot.networkUpBytesPerS;

/**
 * The system monitor's mirror of the Rust module's latest reading
 * (docs/modules/system-monitor.md). Fed by `useSystemMonitorSubscription` while the panel is
 * mounted; nothing here polls, and the Rust side stops sampling when the panel unmounts.
 */
export const useSystemMonitorStore = create<SystemMonitorStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  peakNetworkBytesPerS: 0,
  setSnapshot: (snapshot, at = Date.now()) => {
    set((state) => ({
      snapshot,
      receivedAt: at,
      peakNetworkBytesPerS:
        snapshot === null
          ? state.peakNetworkBytesPerS
          : Math.max(state.peakNetworkBytesPerS, networkTotal(snapshot) ?? 0),
    }));
  },
}));
