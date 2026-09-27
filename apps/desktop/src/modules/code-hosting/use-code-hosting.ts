import {
  type CodeHostingCommand,
  type CodeHostingSnapshot,
  commands,
  events,
  type IpcError,
} from '@muna/contracts';
import { useCallback, useEffect } from 'react';

import { useCodeHostingStore } from './code-hosting-store';

/**
 * Mirrors the Rust code-hosting service into `useCodeHostingStore` while the caller is
 * mounted: one `get_code_hosting_snapshot` round trip, then `CodeHostingChanged`. Unlistens
 * on unmount so a closed panel costs nothing (PRD performance budget).
 */
export function useCodeHostingSubscription(): void {
  const setSnapshot = useCodeHostingStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const outsideTauri = () => {
      // Storybook and tests: the store keeps whatever was seeded.
    };
    void events.codeHostingChanged
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
      .getCodeHostingSnapshot()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch(outsideTauri);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

/**
 * Sends a `CodeHostingCommand` and applies the snapshot it returns; the `CodeHostingChanged`
 * that follows (the poll's answer) says the rest.
 */
export function useCodeHostingCommand(): (command: CodeHostingCommand) => void {
  const setSnapshot = useCodeHostingStore((store) => store.setSnapshot);
  return useCallback(
    (command: CodeHostingCommand) => {
      void commands
        .codeHostingCommand(command)
        .then(setSnapshot)
        .catch(() => {
          // Outside Tauri (tests, Storybook) the seeded snapshot stands.
        });
    },
    [setSnapshot],
  );
}

/** Why a connect was refused, by the IPC error code the Rust side maps to. */
export type ConnectFailure =
  | 'disabled'
  | 'empty'
  | 'malformed'
  | 'offline'
  | 'unauthorized'
  | 'rateLimited'
  | 'provider'
  | 'vault'
  | 'failed';

export type ConnectOutcome =
  { status: 'ok'; snapshot: CodeHostingSnapshot } | { status: 'error'; failure: ConnectFailure };

const connectFailureOf = (error: IpcError): ConnectFailure => {
  switch (error.code) {
    case 'codeHosting.disabled':
      return 'disabled';
    case 'codeHosting.token.empty':
      return 'empty';
    case 'codeHosting.token.malformed':
      return 'malformed';
    case 'codeHosting.offline':
      return 'offline';
    case 'codeHosting.unauthorized':
      return 'unauthorized';
    case 'codeHosting.rateLimited':
      return 'rateLimited';
    case 'codeHosting.provider':
      return 'provider';
    case 'codeHosting.vault':
      return 'vault';
    default:
      return 'failed';
  }
};

/**
 * Connects an account. The token goes to Rust once, is checked against the host and stays in
 * the credential vault; it is never echoed back and never reaches the settings document.
 */
export async function connect(token: string): Promise<ConnectOutcome> {
  try {
    const result = await commands.codeHostingConnect(token);
    return result.status === 'ok'
      ? { status: 'ok', snapshot: result.data }
      : { status: 'error', failure: connectFailureOf(result.error) };
  } catch {
    // Outside Tauri (tests, Storybook) there is no vault.
    return { status: 'error', failure: 'failed' };
  }
}

/** Forgets the token, the account and the cached queue; answers the snapshot that remains. */
export async function disconnect(): Promise<CodeHostingSnapshot | null> {
  try {
    return await commands.codeHostingDisconnect();
  } catch {
    return null;
  }
}

/** Opens a pull request's page in the default browser, through Rust. */
export async function openPullRequest(id: string): Promise<boolean> {
  try {
    const result = await commands.codeHostingOpen(id);
    return result.status === 'ok';
  } catch {
    return false;
  }
}

/** Opens the host's new-token page, pre-filled with what Muna needs, in the default browser. */
export async function openTokenPage(): Promise<boolean> {
  try {
    const result = await commands.codeHostingOpenTokenPage();
    return result.status === 'ok';
  } catch {
    return false;
  }
}
