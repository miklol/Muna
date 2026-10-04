import type { AiCodingSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface AiCodingStore {
  /** Last `AiCodingChanged` (or the answer to `getAiCodingSnapshot`); `null` until then. */
  snapshot: AiCodingSnapshot | null;
  /** `Date.now()` when `snapshot` arrived. */
  receivedAt: number;
  setSnapshot: (snapshot: AiCodingSnapshot, at?: number) => void;
}

/**
 * The AI coding module's mirror of the Rust sessions service (docs/modules/ai-coding.md). Fed
 * by `useAiCodingSubscription` while the panel, the widget or the settings pane is mounted;
 * Rust publishes only while something watches, so a closed panel costs nothing. Nothing here
 * ticks: elapsed times are the snapshot's, refreshed with every change Rust sends.
 */
export const useAiCodingStore = create<AiCodingStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  setSnapshot: (snapshot, at = Date.now()) => {
    set({ snapshot, receivedAt: at });
  },
}));
