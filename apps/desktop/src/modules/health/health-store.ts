import type { HealthSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface HealthStore {
  /** Last `HealthChanged`; `null` until the first snapshot arrives. */
  snapshot: HealthSnapshot | null;
  /** `Date.now()` when `snapshot` arrived; the clocks interpolate from here. */
  receivedAt: number;
  setSnapshot: (snapshot: HealthSnapshot, at?: number) => void;
}

/**
 * The health module's mirror of the Rust tracker (docs/modules/health.md). Fed by
 * `useHealthSubscription` while the panel, the widget or the settings pane is mounted. Rust
 * publishes a snapshot only when something discrete changes (a sit starts or ends, a reminder
 * comes up, a flow starts or finishes, water is logged); the sitting time and the countdowns
 * are interpolated locally from `receivedAt`. Nothing here polls.
 */
export const useHealthStore = create<HealthStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  setSnapshot: (snapshot, at = Date.now()) => {
    set({ snapshot, receivedAt: at });
  },
}));
