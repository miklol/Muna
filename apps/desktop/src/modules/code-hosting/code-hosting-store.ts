import type { CodeHostingFilter, CodeHostingSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface CodeHostingStore {
  /** Last `CodeHostingChanged`; `null` until the first snapshot arrives. */
  snapshot: CodeHostingSnapshot | null;
  /** Which rows the panel shows; UI state only, never saved (docs/modules/code-hosting.md). */
  filter: CodeHostingFilter;
  setSnapshot: (snapshot: CodeHostingSnapshot) => void;
  setFilter: (filter: CodeHostingFilter) => void;
}

/**
 * The code-hosting module's mirror of the Rust service (docs/modules/code-hosting.md). Fed by
 * `useCodeHostingSubscription` while the panel, the widget or the settings pane is mounted.
 * Nothing here polls: the two-minute clock and the token live in Rust, so a closed panel costs
 * nothing. The filter outlives the panel so reopening it shows the same rows.
 */
export const useCodeHostingStore = create<CodeHostingStore>()((set) => ({
  snapshot: null,
  filter: 'toReview',
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
  setFilter: (filter) => {
    set({ filter });
  },
}));
