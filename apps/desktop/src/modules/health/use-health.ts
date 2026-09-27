import { commands, events, type HealthCommand } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useHealthStore } from './health-store';

const outsideTauri = () => {
  // Storybook and tests: the store keeps whatever was seeded.
};

/**
 * Mirrors the Rust tracker into `useHealthStore` while the caller is mounted: one
 * `get_health_snapshot` round trip, then `HealthChanged`. Unlistens on unmount so a closed
 * panel costs nothing (PRD performance budget).
 */
export function useHealthSubscription(): void {
  const setSnapshot = useHealthStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.healthChanged
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
      .getHealthSnapshot()
      .then((result) => {
        if (!disposed && result.status === 'ok') setSnapshot(result.data);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

/**
 * Sends a `HealthCommand` (start or stop a flow, log water, answer the reminder, reset today,
 * clear the history) and applies the snapshot it answers with. Resolves with whether Rust
 * took it; outside Tauri the seeded snapshot stands.
 */
export function useHealthCommand(): (command: HealthCommand) => Promise<boolean> {
  const setSnapshot = useHealthStore((store) => store.setSnapshot);
  return useCallback(
    async (command: HealthCommand) => {
      try {
        const result = await commands.healthCommand(command);
        if (result.status === 'ok') {
          setSnapshot(result.data);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [setSnapshot],
  );
}
