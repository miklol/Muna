import type { TranslateError, TranslationSnapshot } from '@muna/contracts';
import { create } from 'zustand';

/** Why a translation did not happen or did not finish; `failed` when Rust could not be asked. */
export type TranslationFailure = TranslateError | 'failed';

export type TranslationPhase = 'idle' | 'running' | 'done' | 'failed';

/** What the output box shows: nothing yet, text arriving, the whole answer, or why it stopped. */
export interface TranslationResult {
  phase: TranslationPhase;
  /** What has arrived so far; the whole translation once `done`, partial when `failed` midway. */
  output: string;
  failure: TranslationFailure | null;
}

export const idleResult = (): TranslationResult => ({ phase: 'idle', output: '', failure: null });

export interface TranslationStore {
  /** Last `TranslationChanged`; `null` until the first snapshot arrives. */
  snapshot: TranslationSnapshot | null;
  /** The text in the source box. Outlives the panel so a collapse does not lose a paragraph. */
  draft: string;
  result: TranslationResult;
  /** The *Translate text* action ran: the panel puts the caret in the source box when it mounts. */
  focusRequested: boolean;
  setSnapshot: (snapshot: TranslationSnapshot) => void;
  setDraft: (draft: string) => void;
  setResult: (recipe: (current: TranslationResult) => TranslationResult) => void;
  requestFocus: () => void;
  clearFocusRequest: () => void;
}

/**
 * The translation module's mirror of the Rust service (docs/modules/translation.md), fed by
 * `useTranslationSubscription` and `useTranslator` while the panel or the pane is mounted.
 * Nothing here polls or keeps a timer; the request and the key live in Rust. The draft and the
 * last finished translation outlive the panel so reopening it shows the same text; a request
 * still running when the panel unmounts is cancelled and its partial output dropped.
 */
export const useTranslationStore = create<TranslationStore>()((set) => ({
  snapshot: null,
  draft: '',
  result: idleResult(),
  focusRequested: false,
  setSnapshot: (snapshot) => {
    set({ snapshot });
  },
  setDraft: (draft) => {
    set({ draft });
  },
  setResult: (recipe) => {
    set((state) => ({ result: recipe(state.result) }));
  },
  requestFocus: () => {
    set({ focusRequested: true });
  },
  clearFocusRequest: () => {
    set({ focusRequested: false });
  },
}));
