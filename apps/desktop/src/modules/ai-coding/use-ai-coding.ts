import { type AiCodingCommand, commands, events, type IpcError } from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useAiCodingStore } from './ai-coding-store';

const outsideTauri = () => {
  // Storybook and tests: the store keeps whatever was seeded.
};

/**
 * Mirrors the Rust sessions service into `useAiCodingStore` while the caller is mounted.
 * Mounting tells Rust a window is watching (`ai_coding_watch(true)`), which makes every change
 * publish `AiCodingChanged` and quickens the Copilot CLI poll; one `get_ai_coding_snapshot`
 * round trip paints the first frame. Unmounting unwatches and unlistens, so a closed panel
 * costs nothing (docs/modules/ai-coding.md).
 */
export function useAiCodingSubscription(): void {
  const setSnapshot = useAiCodingStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.aiCodingChanged
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
    void commands.aiCodingWatch(true).catch(outsideTauri);
    void commands
      .getAiCodingSnapshot()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
      void commands.aiCodingWatch(false).catch(outsideTauri);
    };
  }, [setSnapshot]);
}

/** Why a command was refused, by the IPC error code the Rust side maps to. */
export type AiCodingFailure =
  'unknown' | 'notWaiting' | 'noProfile' | 'hooksFile' | 'io' | 'failed';

export type AiCodingOutcome = { status: 'ok' } | { status: 'error'; failure: AiCodingFailure };

const failureOf = (error: IpcError): AiCodingFailure => {
  switch (error.code) {
    case 'aiCoding.unknown':
      return 'unknown';
    case 'aiCoding.notWaiting':
      return 'notWaiting';
    case 'aiCoding.noProfile':
      return 'noProfile';
    case 'aiCoding.hooksFile':
      return 'hooksFile';
    case 'aiCoding.io':
      return 'io';
    default:
      return 'failed';
  }
};

/**
 * Sends an `AiCodingCommand` (allow, deny, focus, dismiss, refresh, install or remove the
 * Claude Code hooks) and applies the snapshot it answers with; resolves with why when Rust
 * refused.
 */
export function useAiCodingCommand(): (command: AiCodingCommand) => Promise<AiCodingOutcome> {
  const setSnapshot = useAiCodingStore((store) => store.setSnapshot);
  return useCallback(
    async (command: AiCodingCommand) => {
      try {
        const result = await commands.aiCodingCommand(command);
        if (result.status === 'ok') {
          setSnapshot(result.data);
          return { status: 'ok' };
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
