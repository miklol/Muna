import type { PomodoroState } from '@muna/contracts';
import { create } from 'zustand';

export interface PomodoroStore {
  /** Last `PomodoroStateChanged`; `null` until the first snapshot arrives. */
  state: PomodoroState | null;
  /** `Date.now()` when `state` arrived; the countdown interpolates from here. */
  receivedAt: number;
  setState: (state: PomodoroState, at?: number) => void;
}

/**
 * The pomodoro module's mirror of the Rust timer (docs/modules/pomodoro.md). Fed by
 * `usePomodoroSubscription` while the panel or the settings pane is mounted; the strip never
 * needs it because its countdown arrives through `StripContentChanged`. Nothing here polls.
 */
export const usePomodoroStore = create<PomodoroStore>()((set) => ({
  state: null,
  receivedAt: 0,
  setState: (state, at = Date.now()) => {
    set({ state, receivedAt: at });
  },
}));
