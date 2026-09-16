import type { ShapeRect } from '@muna/contracts';
import { commands, events } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { currentWindowLabel } from '../lib/window-label';
import { useAppStore } from '../store/app-store';

const ignoreIpcFailure = () => {
  // Not running inside Tauri (tests, Storybook): there is no shell to talk to.
};

type Unlisten = () => void;

/** Subscribes to a tauri-specta event for the lifetime of the effect. */
const listenWhileMounted = (subscribe: () => Promise<Unlisten>): Unlisten => {
  let disposed = false;
  let unlisten: Unlisten | undefined;
  subscribe()
    .then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    })
    .catch(ignoreIpcFailure);
  return () => {
    disposed = true;
    unlisten?.();
  };
};

/**
 * Mirrors the shell's view of this window into the store: the initial layout from
 * `getShellLayout`, then `ShellLayoutChanged` / `ShellYieldChanged` filtered on this
 * window's label (the shell broadcasts to every window).
 */
export function useShellLayoutSubscription() {
  const setShellLayout = useAppStore((state) => state.setShellLayout);
  const setYieldState = useAppStore((state) => state.setYieldState);

  useEffect(() => {
    const label = currentWindowLabel();
    let cancelled = false;
    commands
      .getShellLayout()
      .then((result) => {
        if (!cancelled && result.status === 'ok' && result.data) {
          setShellLayout(result.data);
        }
      })
      .catch(ignoreIpcFailure);

    const stopLayout = listenWhileMounted(() =>
      events.shellLayoutChanged.listen((event) => {
        if (event.payload.layout.label === label) {
          setShellLayout(event.payload.layout);
        }
      }),
    );
    const stopYield = listenWhileMounted(() =>
      events.shellYieldChanged.listen((event) => {
        if (event.payload.label === label) {
          setYieldState(event.payload.state);
        }
      }),
    );
    return () => {
      cancelled = true;
      stopLayout();
      stopYield();
    };
  }, [setShellLayout, setYieldState]);
}

export const toShapeRect = (rect: DOMRect): ShapeRect => ({
  x: Math.round(rect.left),
  y: Math.round(rect.top),
  width: Math.round(rect.width),
  height: Math.round(rect.height),
});

/**
 * Tells the shell which painted rects may receive the pointer (the first one must be the
 * strip) and, once, that the first frame is on screen so the window can be moved into place.
 * Ready is two animation frames after mount (docs/modules/notch-shell.md, "moved into place
 * after the UI reports ready").
 */
export function useShellReady(measure: () => ShapeRect[]) {
  const publish = useCallback(() => {
    const rects = measure();
    if (rects.length > 0) {
      commands.publishShapeRects(rects).then(ignoreIpcFailure, ignoreIpcFailure);
    }
  }, [measure]);

  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        publish();
        commands.shellReady().then(ignoreIpcFailure, ignoreIpcFailure);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [publish]);

  return publish;
}
