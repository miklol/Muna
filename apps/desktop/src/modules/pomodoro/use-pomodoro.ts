import { commands, events } from '@muna/contracts';
import { useEffect } from 'react';

import { usePomodoroStore } from './pomodoro-store';

/**
 * Mirrors the Rust timer into `usePomodoroStore` while the caller is mounted: one
 * `get_pomodoro_snapshot` round trip, then `PomodoroStateChanged`. Unlistens on unmount so a
 * closed panel costs nothing (PRD performance budget).
 */
export function usePomodoroSubscription(): void {
  const setState = usePomodoroStore((store) => store.setState);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.pomodoroStateChanged
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
      .getPomodoroSnapshot()
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
