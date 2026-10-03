import type { WeatherSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface WeatherStore {
  /** Last `WeatherChanged`; `null` until the first snapshot arrives. */
  snapshot: WeatherSnapshot | null;
  setSnapshot: (snapshot: WeatherSnapshot) => void;
}

/**
 * The weather module's mirror of the Rust service (docs/modules/weather.md). Fed by
 * `useWeatherSubscription` while the panel or the settings pane is mounted. Nothing here polls:
 * the refresh clock lives in Rust, so a closed panel costs nothing.
 */
export const useWeatherStore = create<WeatherStore>()((set) => ({
  snapshot: null,
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
}));
