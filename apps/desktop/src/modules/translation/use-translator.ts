import {
  commands,
  events,
  type IpcError,
  type TranslateRequest,
  translateErrorSchema,
  type TranslationChunk,
  type TranslationSnapshot,
} from '@muna/contracts';
import { useCallback, useEffect, useRef } from 'react';

import {
  idleResult,
  type TranslationFailure,
  type TranslationResult,
  useTranslationStore,
} from './translation-store';

const ignore = () => {
  // Outside Tauri (tests, Storybook) there is no service to reach.
};

/** The failure an `IpcError` from the translation commands stands for. */
export const failureOf = (error: IpcError): TranslationFailure => {
  const prefix = 'translation.';
  const code = error.code.startsWith(prefix) ? error.code.slice(prefix.length) : '';
  const parsed = translateErrorSchema.safeParse(code);
  return parsed.success ? parsed.data : 'failed';
};

/**
 * Mirrors the Rust translation service into `useTranslationStore` while the caller is
 * mounted: one `get_translation_snapshot` round trip, then `TranslationChanged`. Unlistens on
 * unmount so a closed panel costs nothing (PRD performance budget).
 */
export function useTranslationSubscription(): void {
  const setSnapshot = useTranslationStore((store) => store.setSnapshot);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.translationChanged
      .listen((event) => {
        setSnapshot(event.payload.snapshot);
      })
      .then((stop) => {
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      }, ignore);
    void commands
      .getTranslationSnapshot()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch(ignore);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setSnapshot]);
}

/** Chunks that arrived before `translate` answered with the request's id, per id. */
interface Early {
  text: string;
  done: boolean;
  error: TranslationChunk['error'];
}

/** At most this many unknown ids are buffered while an id is awaited; older ones are dropped. */
const EARLY_LIMIT = 8;

interface Session {
  /** Bumped by every `translate` and `cancel`; a late answer for an older generation is dropped. */
  generation: number;
  /** The running request's id once Rust has answered; `null` before and after. */
  id: number | null;
  /** `translate` has been sent and its id is not back yet: chunks are buffered by id. */
  awaiting: boolean;
  running: boolean;
  early: Map<number, Early>;
}

export interface Translator {
  /** Starts a translation; an earlier one still running is cancelled first. */
  translate: (request: TranslateRequest) => void;
  /** Drops the running request (nothing more arrives) and clears the partial output. */
  cancel: () => void;
}

/**
 * Drives one translation at a time from the panel (docs/modules/translation.md): `translate`
 * asks Rust and streams the `TranslationChunkEvent`s with the answered id into the store;
 * `cancel` stops it. Chunks may reach the webview before the `translate` promise resolves (the
 * request runs the moment it is accepted), so chunks for ids not yet known are held and adopted
 * once the id is back. A request still running when the caller unmounts is cancelled.
 */
export function useTranslator(): Translator {
  const setResult = useTranslationStore((store) => store.setResult);
  const session = useRef<Session>({
    generation: 0,
    id: null,
    awaiting: false,
    running: false,
    early: new Map(),
  });

  const apply = useCallback(
    (piece: Early) => {
      const current = session.current;
      if (piece.text !== '') {
        setResult((result) => ({ ...result, output: result.output + piece.text }));
      }
      if (piece.done) {
        current.running = false;
        current.id = null;
        const failure = piece.error;
        setResult((result) => ({
          phase: failure === null ? 'done' : 'failed',
          output: result.output,
          failure,
        }));
      }
    },
    [setResult],
  );

  const receive = useCallback(
    (chunk: TranslationChunk) => {
      const current = session.current;
      if (current.awaiting) {
        const early = current.early.get(chunk.requestId) ?? { text: '', done: false, error: null };
        early.text += chunk.text;
        if (chunk.done) {
          early.done = true;
          early.error = chunk.error;
        }
        current.early.set(chunk.requestId, early);
        while (current.early.size > EARLY_LIMIT) {
          const oldest = current.early.keys().next().value;
          if (oldest === undefined) break;
          current.early.delete(oldest);
        }
        return;
      }
      if (!current.running || chunk.requestId !== current.id) return;
      apply({ text: chunk.text, done: chunk.done, error: chunk.error });
    },
    [apply],
  );

  const stop = useCallback(() => {
    const current = session.current;
    current.generation += 1;
    if (current.id !== null) {
      void commands.translationCancel(current.id).catch(ignore);
    }
    current.id = null;
    current.awaiting = false;
    current.running = false;
    current.early.clear();
  }, []);

  useEffect(() => {
    const current = session.current;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void events.translationChunkEvent
      .listen((event) => {
        receive(event.payload.chunk);
      })
      .then((listening) => {
        if (disposed) {
          listening();
        } else {
          unlisten = listening;
        }
      }, ignore);
    return () => {
      disposed = true;
      unlisten?.();
      if (current.running) {
        stop();
        setResult(idleResult);
      }
    };
  }, [receive, setResult, stop]);

  const translate = useCallback(
    (request: TranslateRequest) => {
      const current = session.current;
      if (current.running) stop();
      current.generation += 1;
      const generation = current.generation;
      current.awaiting = true;
      current.running = true;
      setResult(() => ({ phase: 'running', output: '', failure: null }));
      const fail = (failure: TranslationFailure): TranslationResult => ({
        phase: 'failed',
        output: '',
        failure,
      });
      commands.translate(request).then(
        (answer) => {
          if (current.generation !== generation) {
            // Superseded or cancelled while the id was on its way: the request is not wanted.
            if (answer.status === 'ok') void commands.translationCancel(answer.data).catch(ignore);
            return;
          }
          current.awaiting = false;
          if (answer.status === 'error') {
            current.running = false;
            current.early.clear();
            setResult(() => fail(failureOf(answer.error)));
            return;
          }
          current.id = answer.data;
          const early = current.early.get(answer.data);
          current.early.clear();
          if (early !== undefined) apply(early);
        },
        () => {
          if (current.generation !== generation) return;
          current.awaiting = false;
          current.running = false;
          current.early.clear();
          setResult(() => fail('failed'));
        },
      );
    },
    [apply, setResult, stop],
  );

  const cancel = useCallback(() => {
    if (!session.current.running) return;
    stop();
    setResult(idleResult);
  }, [setResult, stop]);

  return { translate, cancel };
}

/** Puts a finished translation on the clipboard, through Rust. `false` when it did not take. */
export async function copyTranslation(text: string): Promise<boolean> {
  try {
    const result = await commands.translationCopy(text);
    return result.status === 'ok';
  } catch {
    return false;
  }
}

/** Why a key was not saved, by the IPC error code the Rust side maps to. */
export type KeyFailure = 'empty' | 'malformed' | 'vault' | 'failed';

export type KeyOutcome =
  { status: 'ok'; snapshot: TranslationSnapshot } | { status: 'error'; failure: KeyFailure };

const keyFailureOf = (error: IpcError): KeyFailure => {
  switch (error.code) {
    case 'translation.key.empty':
      return 'empty';
    case 'translation.key.malformed':
      return 'malformed';
    case 'translation.vault':
      return 'vault';
    default:
      return 'failed';
  }
};

/**
 * Saves the current provider's API key. It goes to Rust once and stays in the credential
 * vault; it is never echoed back and never reaches the settings document.
 */
export async function saveKey(key: string): Promise<KeyOutcome> {
  try {
    const result = await commands.translationSetKey(key);
    return result.status === 'ok'
      ? { status: 'ok', snapshot: result.data }
      : { status: 'error', failure: keyFailureOf(result.error) };
  } catch {
    return { status: 'error', failure: 'failed' };
  }
}

/** Forgets the current provider's key; answers the snapshot that remains. */
export async function removeKey(): Promise<KeyOutcome> {
  try {
    const result = await commands.translationClearKey();
    return result.status === 'ok'
      ? { status: 'ok', snapshot: result.data }
      : { status: 'error', failure: keyFailureOf(result.error) };
  } catch {
    return { status: 'error', failure: 'failed' };
  }
}
