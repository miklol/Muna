import { useEffect, useState } from 'react';

const MINUTE_MS = 60_000;

/** The start of the next whole minute after `nowMs`. */
const nextMinuteMs = (nowMs: number): number => (Math.floor(nowMs / MINUTE_MS) + 1) * MINUTE_MS;

/**
 * The current minute, re-read at every whole minute while mounted. One timeout at a time,
 * aligned to the minute boundary and cleared on unmount, so a now marker moves at the same
 * instant the clock changes and nothing ticks once the panel closes (PRD performance budget).
 * Shared by the modules that lay time out on screen; reading `Date.now()` in render is not
 * allowed (components must be pure) and each module owning a clock would be one timer too many.
 */
export function useMinuteNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const current = Date.now();
      timer = setTimeout(
        () => {
          setNow(new Date());
          arm();
        },
        Math.max(1, Math.min(MINUTE_MS, nextMinuteMs(current) - current)),
      );
    };
    arm();
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return now;
}
