import type { PomodoroState } from '@muna/contracts';
import { timings } from '@muna/ui';
import { useCallback, useSyncExternalStore } from 'react';

import { remainingAt } from './phase';

/** An idle or paused timer subscribes to nothing. */
const noop = (): void => undefined;

/**
 * The time left, refreshed once a second (`timings.progressStepMs`) while the timer runs and
 * only while the caller is mounted; idle and paused states read the snapshot as is and
 * subscribe to nothing. The clock is an external store of whole seconds since the snapshot
 * arrived, so the value is stable between ticks and changes exactly on the second. Rust
 * republishes the exact value once a minute, which resets the interpolation
 * (docs/modules/pomodoro.md, "drift ≤ 1 s over 25 min").
 */
export function useCountdown(
  state: PomodoroState | null,
  receivedAt: number,
  now: () => number = Date.now,
): number {
  const running = state?.status === 'running';
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
  if (state === null) return 0;
  return remainingAt(state, receivedAt, receivedAt + elapsed * 1000);
}
