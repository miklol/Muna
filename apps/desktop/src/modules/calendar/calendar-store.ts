import type { CalendarSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface CalendarStore {
  /** Last `CalendarChanged`; `null` until the first snapshot arrives. */
  snapshot: CalendarSnapshot | null;
  setSnapshot: (snapshot: CalendarSnapshot) => void;
}

/**
 * The calendar module's mirror of the Rust service (docs/modules/calendar.md). Fed by
 * `useCalendarSubscription` while the panel, the widget or the settings pane is mounted.
 * Nothing here polls: the refresh clock and the strip countdown live in Rust, so a closed
 * panel costs nothing.
 */
export const useCalendarStore = create<CalendarStore>()((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
}));
