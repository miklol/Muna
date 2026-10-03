import type { PomodoroState, Task } from '@muna/contracts';
import { commands, events } from '@muna/contracts';
import { useEffect, useState } from 'react';

import { MINUTE_MS, nextMinuteMs } from './timeline';

export interface DaySources {
  /** Every task Rust holds, or `null` before the first snapshot (and outside Tauri). */
  readonly tasks: readonly Task[] | null;
  readonly pomodoro: PomodoroState | null;
}

/**
 * Mirrors the to-do and pomodoro snapshots while the panel is mounted: one round trip each,
 * then `TodoChanged` and `PomodoroStateChanged`, so a task edit reaches the timeline within the
 * acceptance criterion's second. Reads the contract directly — modules never import each other
 * (ADR-0004) — and unlistens on unmount so a closed panel costs nothing.
 */
export function useDaySources(): DaySources {
  const [tasks, setTasks] = useState<readonly Task[] | null>(null);
  const [pomodoro, setPomodoro] = useState<PomodoroState | null>(null);

  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const outsideTauri = () => {
      // Storybook and tests: the sources stay empty.
    };
    const keep = (stop: () => void) => {
      if (disposed) {
        stop();
      } else {
        stops.push(stop);
      }
    };
    void events.todoChanged
      .listen((event) => {
        setTasks(event.payload.snapshot.tasks);
      })
      .then(keep, outsideTauri);
    void events.pomodoroStateChanged
      .listen((event) => {
        setPomodoro(event.payload.state);
      })
      .then(keep, outsideTauri);
    void commands
      .getTodoSnapshot()
      .then((result) => {
        if (!disposed && result.status === 'ok') setTasks(result.data.tasks);
      })
      .catch(outsideTauri);
    void commands
      .getPomodoroSnapshot()
      .then((state) => {
        if (!disposed) setPomodoro(state);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      for (const stop of stops) stop();
    };
  }, []);

  return { tasks, pomodoro };
}

/**
 * The current minute, re-read at every whole minute while mounted. One timeout at a time,
 * aligned to the minute boundary and cleared on unmount, so the now marker moves at the same
 * instant the clock changes and nothing ticks once the panel closes (PRD performance budget).
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
