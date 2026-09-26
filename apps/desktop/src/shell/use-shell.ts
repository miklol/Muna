import type { MorphReport, ShapeRect } from '@muna/contracts';
import { commands, events } from '@muna/contracts';
import { useEffect, useLayoutEffect, useRef } from 'react';

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

/**
 * A global hotkey fired over this window's monitor (`HotkeyPressed`); `action` is the id the
 * chord is bound to, resolved against the shell's actions and the module registry.
 */
export function useHotkeySubscription(onAction: (action: string) => void) {
  useEffect(() => {
    const label = currentWindowLabel();
    return listenWhileMounted(() =>
      events.hotkeyPressed.listen((event) => {
        if (event.payload.label === label) {
          onAction(event.payload.action);
        }
      }),
    );
  }, [onAction]);
}

/**
 * A mouse button went down outside every published shape while the window was click-through
 * (`ShellPointerDownOutside`); the UI never sees that click itself.
 */
export function useShellPointerDownOutsideSubscription(onPress: () => void) {
  useEffect(() => {
    const label = currentWindowLabel();
    return listenWhileMounted(() =>
      events.shellPointerDownOutside.listen((event) => {
        if (event.payload.label === label) {
          onPress();
        }
      }),
    );
  }, [onPress]);
}

/**
 * Mirrors a drag carrying files over this window into the store (docs/modules/drop-actions.md):
 * `DropEntered` opens a session, `DropMoved` follows the pointer, `Dropped` marks the release
 * and `DropLeft` ends it. Every event is filtered on this window's label; the shell emits them
 * from its drag-drop handler with positions already in this window's CSS px.
 */
export function useDropSubscription() {
  const beginDrop = useAppStore((state) => state.beginDrop);
  const moveDrop = useAppStore((state) => state.moveDrop);
  const markDropped = useAppStore((state) => state.markDropped);
  const endDrop = useAppStore((state) => state.endDrop);

  useEffect(() => {
    const label = currentWindowLabel();
    const stops = [
      listenWhileMounted(() =>
        events.dropEntered.listen((event) => {
          if (event.payload.label === label) {
            beginDrop(event.payload.session, event.payload.items, event.payload.position);
          }
        }),
      ),
      listenWhileMounted(() =>
        events.dropMoved.listen((event) => {
          if (event.payload.label === label) {
            moveDrop(event.payload.session, event.payload.position);
          }
        }),
      ),
      listenWhileMounted(() =>
        events.dropped.listen((event) => {
          if (event.payload.label === label) {
            markDropped(event.payload.session, event.payload.position);
          }
        }),
      ),
      listenWhileMounted(() =>
        events.dropLeft.listen((event) => {
          if (event.payload.label === label) {
            endDrop(event.payload.session);
          }
        }),
      ),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [beginDrop, endDrop, markDropped, moveDrop]);
}

/** Forgets a drag's items in Rust: the drop landed on no tile, or the row was dismissed. */
export const cancelDrop = (session: number): void => {
  commands.dropCancel(session).then(ignoreIpcFailure, ignoreIpcFailure);
};

/**
 * Mirrors a tracked window drag into the store (docs/modules/window-snap.md): `SnapDragMoved`
 * and `SnapDragLeft` are filtered on this window's label — the shell emits them for the notch
 * window under the cursor with positions in its CSS px — while `SnapDragEnded` reaches every
 * window, naming the one the cursor was over.
 */
export function useSnapSubscription() {
  const moveSnap = useAppStore((state) => state.moveSnap);
  const leaveSnap = useAppStore((state) => state.leaveSnap);
  const markSnapEnded = useAppStore((state) => state.markSnapEnded);

  useEffect(() => {
    const label = currentWindowLabel();
    const stops = [
      listenWhileMounted(() =>
        events.snapDragMoved.listen((event) => {
          if (event.payload.label === label) {
            moveSnap(event.payload.session, event.payload.position);
          }
        }),
      ),
      listenWhileMounted(() =>
        events.snapDragLeft.listen((event) => {
          if (event.payload.label === label) {
            leaveSnap(event.payload.session);
          }
        }),
      ),
      listenWhileMounted(() =>
        events.snapDragEnded.listen((event) => {
          markSnapEnded(event.payload.session, event.payload.label);
        }),
      ),
    ];
    return () => {
      for (const stop of stops) {
        stop();
      }
    };
  }, [leaveSnap, markSnapEnded, moveSnap]);
}

/** Forgets a window drag in Rust: it ended over no zone, or the zones were dismissed. */
export const cancelSnap = (session: number): void => {
  commands.snapCancel(session).then(ignoreIpcFailure, ignoreIpcFailure);
};

/** Asks the shell to let this window take keyboard focus (a text field is focused). */
export const setNotchFocusable = (focusable: boolean): void => {
  commands.setNotchFocusable(focusable).then(ignoreIpcFailure, ignoreIpcFailure);
};

/** Hands one morph's frame statistics to the shell (trace log; perf evidence). */
export const reportMorph = (report: MorphReport): void => {
  commands.reportMorph(report).then(ignoreIpcFailure, ignoreIpcFailure);
};

/** Publishes the rects the pointer may hit; the first must be the strip at rest. */
export const publishShapeRects = (rects: ShapeRect[]): void => {
  commands.publishShapeRects(rects).then(ignoreIpcFailure, ignoreIpcFailure);
};

/**
 * Pauses (`true`) or resumes (`false`) strip scheduling while the panel covers the strip
 * (docs/modules/live-activities.md, "Rules"): notices queue and are released on resume.
 */
export const setStripSuspended = (suspended: boolean): void => {
  commands.setStripSuspended(suspended).then(ignoreIpcFailure, ignoreIpcFailure);
};

/**
 * Tells the shell, once, that the first frame is on screen so the window can be moved into
 * place — two animation frames after mount (docs/modules/notch-shell.md, "moved into place
 * after the UI reports ready") — right after `publish` has handed over the painted rects.
 * The latest `publish` is read through a ref: the shell answers `shellReady` with a layout
 * event, so re-running on every new `publish` identity would loop at frame rate.
 */
export function useShellReady(publish: () => void) {
  const latestPublish = useRef(publish);
  useLayoutEffect(() => {
    latestPublish.current = publish;
  });
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        latestPublish.current();
        commands.shellReady().then(ignoreIpcFailure, ignoreIpcFailure);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, []);
}
