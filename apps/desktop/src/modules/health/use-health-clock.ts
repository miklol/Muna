import type { HealthSnapshot } from '@muna/contracts';
import { timings } from '@muna/ui';
import { useCallback, useSyncExternalStore } from 'react';

import { clockAt, clockRuns, type HealthClock } from './format';

/** An away, locked or off tracker with no flow subscribes to nothing. */
const noop = (): void => undefined;

const frozen: HealthClock = {
  sittingMs: 0,
  nextBreakInMs: null,
  flowRemainingMs: null,
  flowElapsedMs: null,
};

/**
 * The sitting time, the time to the next reminder and the flow countdown, refreshed once a
 * second (`timings.progressStepMs`) while a sit counts or a flow runs and only while the
 * caller is mounted; otherwise the snapshot is read as is and nothing ticks. The clock is an
 * external store of whole seconds since the snapshot arrived, so the values are stable between
 * ticks and change exactly on the second. Rust republishes an exact snapshot on every change,
 * which resets the interpolation.
 */
export function useHealthClock(
  snapshot: HealthSnapshot | null,
  receivedAt: number,
  now: () => number = Date.now,
): HealthClock {
  const running = clockRuns(snapshot);
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (!running) return noop;
      const id = window.setInterval(onTick, timings.progressStepMs);
      return () => {
        window.clearInterval(id);
      };
    },
    [running],
  );
  const elapsedSeconds = useCallback(
    () => (running ? Math.max(0, Math.floor((now() - receivedAt) / 1000)) : 0),
    [now, receivedAt, running],
  );
  const elapsed = useSyncExternalStore(subscribe, elapsedSeconds, elapsedSeconds);
  if (snapshot === null) return frozen;
  return clockAt(snapshot, elapsed * 1000);
}
