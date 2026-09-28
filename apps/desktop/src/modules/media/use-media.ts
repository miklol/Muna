import { commands, events } from '@muna/contracts';
import { useEffect } from 'react';

import { useMediaStore } from './media-store';

/**
 * Mirrors the Rust media tracker into `useMediaStore` while the caller is mounted: one
 * `get_media_snapshot` round trip, then `MediaStateChanged` / `MediaArtChanged`. Unlistens on
 * unmount so a closed panel costs nothing (PRD performance budget); the strip never needs this
 * because its content arrives through `StripContentChanged`.
 */
export function useMediaSubscription(): void {
  const setState = useMediaStore((store) => store.setState);
  const setArt = useMediaStore((store) => store.setArt);
  useEffect(() => {
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    const keep = (unlisten: () => void) => {
      if (disposed) {
        unlisten();
      } else {
        unlisteners.push(unlisten);
      }
    };
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.mediaStateChanged
      .listen((event) => {
        setState(event.payload.state);
      })
      .then(keep, outsideTauri);
    void events.mediaArtChanged
      .listen((event) => {
        setArt(event.payload.art);
      })
      .then(keep, outsideTauri);
    void commands
      .getMediaSnapshot()
      .then((snapshot) => {
        if (disposed) return;
        setState(snapshot.state);
        setArt(snapshot.art);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [setArt, setState]);
}
