import type { NotesSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface NotesStore {
  /** Last `NotesChanged` (or the answer to `getNotesSnapshot`); `null` until the first arrives. */
  snapshot: NotesSnapshot | null;
  /** `Date.now()` when `snapshot` arrived; "Edited …" words read time from here. */
  receivedAt: number;
  /**
   * Set by the `notes.quickNote` action (a global shortcut or the palette) before the panel
   * opens; the panel opens *Inbox* in the editor with the caret at the end and clears it.
   */
  quickNotePending: boolean;
  setSnapshot: (snapshot: NotesSnapshot, at?: number) => void;
  requestQuickNote: () => void;
  consumeQuickNote: () => void;
}

/**
 * The notes module's mirror of the Rust folder service (docs/modules/notes.md). Fed by
 * `useNotesSubscription` while the panel, the widget or the settings pane is mounted. Nothing
 * here polls or watches: every snapshot is a rescan the Rust side runs on request, so a closed
 * panel costs nothing. Note bodies never live here — the editor holds the one it shows.
 */
export const useNotesStore = create<NotesStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  quickNotePending: false,
  setSnapshot: (snapshot, at = Date.now()) => {
    set({ snapshot, receivedAt: at });
  },
  requestQuickNote: () => {
    set({ quickNotePending: true });
  },
  consumeQuickNote: () => {
    set({ quickNotePending: false });
  },
}));
