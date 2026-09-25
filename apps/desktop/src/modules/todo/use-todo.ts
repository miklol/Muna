import { commands, events, type TodoCommand } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useTodoStore } from './todo-store';

/**
 * Mirrors the Rust task store into `useTodoStore` while the caller is mounted: one
 * `get_todo_snapshot` round trip, then `TodoChanged`. Unlistens on unmount so a closed panel
 * costs nothing (PRD performance budget).
 */
export function useTodoSubscription(): void {
  const setSnapshot = useTodoStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.todoChanged
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
      .getTodoSnapshot()
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
 * Sends a `TodoCommand` and applies the snapshot it returns; the `TodoChanged` that follows
 * says the same. A refused command (blank title) or running outside Tauri leaves the store as
 * it was.
 */
export function useTodoCommand(): (command: TodoCommand) => void {
  const setSnapshot = useTodoStore((store) => store.setSnapshot);
  return useCallback(
    (command: TodoCommand) => {
      void commands
        .todoCommand(command)
        .then((result) => {
          if (result.status === 'ok') setSnapshot(result.data);
        })
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        });
    },
    [setSnapshot],
  );
}
