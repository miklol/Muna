import type { HudState } from '@muna/contracts';
import { create } from 'zustand';

export interface HudStore {
  /** Last `HudStateChanged`; `null` until the first snapshot arrives. */
  state: HudState | null;
  setState: (state: HudState) => void;
}

/**
 * The HUD module's mirror of the Rust tracker (docs/modules/hud.md). Fed by
 * `useHudSubscription` while a settings pane is mounted; the strip never needs it because its
 * notice arrives through `StripContentChanged`. Nothing here polls.
 */
export const useHudStore = create<HudStore>()((set) => ({
  state: null,
  setState: (state) => {
    set({ state });
  },
}));
