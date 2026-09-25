import { commands, events } from '@muna/contracts';
import { useEffect } from 'react';

import { useSystemMonitorStore } from './system-monitor-store';

/**
 * Mirrors the Rust module's readings into `useSystemMonitorStore` while the caller is mounted.
 * Mounting tells Rust a panel is watching (`system_monitor_watch(true)`), which starts the
 * 1 Hz sampling and returns the latest reading for the first paint; `SystemMonitorChanged`
 * carries every reading after that. Unmounting unwatches and unlistens, so a closed panel costs
 * nothing (docs/modules/system-monitor.md acceptance criteria).
 */
export function useSystemMonitorSubscription(): void {
  const setSnapshot = useSystemMonitorStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.systemMonitorChanged
      .listen((event) => {
        setSnapshot(event.payload.snapshot);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, outsideTauri);
    void commands
      .systemMonitorWatch(true)
      .then((latest) => {
        if (!disposed && latest !== null) setSnapshot(latest);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
      void commands.systemMonitorWatch(false).catch(outsideTauri);
    };
  }, [setSnapshot]);
}
