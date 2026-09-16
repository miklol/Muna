import { events } from '@muna/contracts';
import { useEffect } from 'react';

import { useAppStore } from '../store/app-store';

/**
 * Keeps the store in sync with the Rust scheduler. Subscribes once per mounted window and
 * unlistens on unmount so nothing runs while the window is gone (performance budget).
 */
export function useStripContentSubscription() {
  const setStripContent = useAppStore((state) => state.setStripContent);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void events.stripContentChanged
      .listen((event) => {
        setStripContent(event.payload.content);
      })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {
        // Not running inside Tauri (Storybook, tests); the strip stays idle.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setStripContent]);
}
