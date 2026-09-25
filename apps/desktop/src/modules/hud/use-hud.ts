import { commands, events } from '@muna/contracts';
import { useEffect } from 'react';

import { useHudStore } from './hud-store';

/**
 * Mirrors the Rust HUD tracker into `useHudStore` while the caller is mounted: one
 * `get_hud_snapshot` round trip, then `HudStateChanged`. Unlistens on unmount so a closed
 * settings window costs nothing (PRD performance budget).
 */
export function useHudSubscription(): void {
  const setState = useHudStore((store) => store.setState);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.hudStateChanged
      .listen((event) => {
        setState(event.payload.state);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .getHudSnapshot()
      .then((snapshot) => {
        if (!disposed) setState(snapshot);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setState]);
}
