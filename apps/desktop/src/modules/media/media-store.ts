import type { Artwork, MediaState } from '@muna/contracts';
import { create } from 'zustand';

export interface MediaStore {
  /** Last `MediaStateChanged`; `null` until the first snapshot arrives. */
  state: MediaState | null;
  /** `Date.now()` when `state` arrived; playback position interpolates from here. */
  receivedAt: number;
  /** Pixels for `state.artKey`, or `null` while the track has none. */
  art: Artwork | null;
  setState: (state: MediaState, at?: number) => void;
  setArt: (art: Artwork | null) => void;
}

/**
 * The media module's mirror of the Rust tracker (docs/modules/media.md). Fed by
 * `useMediaSubscription` while the panel is mounted; nothing here polls.
 */
export const useMediaStore = create<MediaStore>()((set) => ({
  state: null,
  receivedAt: 0,
  art: null,
  setState: (state, at = Date.now()) => {
    set({ state, receivedAt: at });
  },
  setArt: (art) => {
    set({ art });
  },
}));
