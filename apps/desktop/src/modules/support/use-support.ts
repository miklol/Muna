import {
  commands,
  events,
  type IpcError,
  type SupportCommand,
  type SupportLink,
  type SupportOutcome,
} from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useSupportStore } from './support-store';

/**
 * Mirrors the Rust support service into `useSupportStore` while the caller is mounted: one
 * `get_support_snapshot` round trip, then `SupportChanged` after every bundle or channel change.
 * Unlistens on unmount so a closed panel costs nothing (PRD performance budget).
 */
export function useSupportSubscription(): void {
  const setSnapshot = useSupportStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.supportChanged
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
      .getSupportSnapshot()
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

/** Why a support command was refused, by the IPC error code the Rust side maps to. */
export type SupportFailure = 'noDesktop' | 'io' | 'zip' | 'updater' | 'failed';

export type CommandOutcome =
  | { status: 'ok'; outcome: SupportOutcome }
  | { status: 'error'; failure: SupportFailure };

const failureOf = (error: IpcError): SupportFailure => {
  switch (error.code) {
    case 'support.noDesktop':
      return 'noDesktop';
    case 'support.io':
      return 'io';
    case 'support.zip':
      return 'zip';
    case 'support.updater':
      return 'updater';
    default:
      return 'failed';
  }
};

/**
 * Sends a `SupportCommand` (diagnostics, a repair, open logs, check for updates) and reports
 * what it produced or why it was refused. Outside Tauri the command fails quietly as `failed`.
 */
export function useSupportCommand(): (command: SupportCommand) => Promise<CommandOutcome> {
  return useCallback(
    (command: SupportCommand) =>
      commands.supportCommand(command).then(
        (result): CommandOutcome =>
          result.status === 'ok'
            ? { status: 'ok', outcome: result.data }
            : { status: 'error', failure: failureOf(result.error) },
        (): CommandOutcome => ({ status: 'error', failure: 'failed' }),
      ),
    [],
  );
}

/** Opens one of the support links in the default browser; the URLs are Rust's. */
export const openLink = (link: SupportLink): Promise<void> =>
  commands.supportOpen(link).then(
    () => undefined,
    () => {
      // Outside Tauri (tests, Storybook) there is no browser to open.
    },
  );

/** The `CHANGELOG.md` bundled with this build, or `null` when none ships (see the snapshot). */
export const loadChangelog = (): Promise<string | null> =>
  commands.supportChangelog().catch(() => null);
