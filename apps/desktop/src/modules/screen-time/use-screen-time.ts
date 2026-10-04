import { commands, events, type IpcError, type ScreenTimeCommand } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useScreenTimeStore } from './screen-time-store';

const outsideTauri = () => {
  // Storybook and tests: the store keeps whatever was seeded.
};

/**
 * Mirrors the Rust tracker into `useScreenTimeStore` while the caller is mounted. Mounting
 * tells Rust a window is watching (`screen_time_watch(true)`), which makes every tick publish
 * `ScreenTimeChanged`; one `get_screen_time_snapshot` round trip paints the first frame.
 * Unmounting unwatches and unlistens, so a closed panel costs nothing
 * (docs/modules/screen-time.md acceptance criteria).
 */
export function useScreenTimeSubscription(): void {
  const setSnapshot = useScreenTimeStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.screenTimeChanged
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
    void commands.screenTimeWatch(true).catch(outsideTauri);
    void commands
      .getScreenTimeSnapshot()
      .then((result) => {
        if (!disposed && result.status === 'ok') setSnapshot(result.data);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
      void commands.screenTimeWatch(false).catch(outsideTauri);
    };
  }, [setSnapshot]);
}

/** Why a command was refused, by the IPC error code the Rust side maps to. */
export type ScreenTimeFailure = 'unknown' | 'io' | 'failed';

export type ScreenTimeOutcome<T> =
  { status: 'ok'; data: T } | { status: 'error'; failure: ScreenTimeFailure };

const failureOf = (error: IpcError): ScreenTimeFailure => {
  switch (error.code) {
    case 'screenTime.unknown':
      return 'unknown';
    case 'screenTime.io':
      return 'io';
    default:
      return 'failed';
  }
};

/**
 * Sends a `ScreenTimeCommand` (exclude, include, set a category or a limit, clear) and applies
 * the snapshot it answers with; resolves with why when Rust refused.
 */
export function useScreenTimeCommand(): (
  command: ScreenTimeCommand,
) => Promise<ScreenTimeOutcome<null>> {
  const setSnapshot = useScreenTimeStore((store) => store.setSnapshot);
  return useCallback(
    async (command: ScreenTimeCommand) => {
      try {
        const result = await commands.screenTimeCommand(command);
        if (result.status === 'ok') {
          setSnapshot(result.data);
          return { status: 'ok', data: null };
        }
        return { status: 'error', failure: failureOf(result.error) };
      } catch {
        // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        return { status: 'error', failure: 'failed' };
      }
    },
    [setSnapshot],
  );
}

/**
 * Writes every recorded span to a CSV in a folder the user picks and reveals the file. `null`
 * when the picker was dismissed (or outside Tauri).
 */
export async function exportScreenTime(title: string): Promise<ScreenTimeOutcome<string | null>> {
  try {
    const result = await commands.screenTimeExport(title);
    return result.status === 'ok'
      ? { status: 'ok', data: result.data }
      : { status: 'error', failure: failureOf(result.error) };
  } catch {
    return { status: 'ok', data: null };
  }
}
