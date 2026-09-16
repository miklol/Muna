import { useCallback, useSyncExternalStore } from 'react';

import { timings } from '../motion/presets';
import { Text, type TextProps } from './text';

export interface TimerTextProps extends Omit<TextProps, 'children' | 'tabular'> {
  /** Time left when the value was published. */
  remainingMs: number;
  /** Counts down locally while `true`; a paused timer shows `remainingMs` as is. */
  running: boolean;
  /**
   * `Date.now()` when `remainingMs` was published. The component counts from here, so a
   * value republished once a minute still reads correctly to the second.
   */
  receivedAt: number;
  /** Clock used for the countdown; tests inject a fake one. */
  now?: () => number;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** A paused timer subscribes to nothing. */
const noop = (): void => undefined;

/** `m:ss` under an hour, `h:mm:ss` above; never negative. */
export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${String(minutes)}:${pad(seconds)}`;
};

/** Time left right now, given what was published and when. */
export const remainingNow = (
  remainingMs: number,
  running: boolean,
  receivedAt: number,
  now: number,
): number => (running ? Math.max(0, remainingMs - (now - receivedAt)) : remainingMs);

/**
 * A countdown in tabular figures. It ticks once a second (`timings.progressStepMs`) only while
 * running and mounted — the strip unmounts it when the panel opens — and reads the published
 * value plus elapsed time, so the backend need not republish every second.
 */
export function TimerText({
  remainingMs,
  running,
  receivedAt,
  now = Date.now,
  variant = 'footnote',
  weight = 600,
  ...rest
}: TimerTextProps) {
  // The clock is an external store: whole seconds elapsed since the value arrived, so the
  // snapshot is stable between ticks and changes exactly on the second.
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

  const left = remainingNow(remainingMs, running, receivedAt, receivedAt + elapsed * 1000);
  return (
    <Text
      {...rest}
      as="time"
      variant={variant}
      weight={weight}
      tabular
      data-running={running || undefined}
    >
      {formatCountdown(left)}
    </Text>
  );
}
