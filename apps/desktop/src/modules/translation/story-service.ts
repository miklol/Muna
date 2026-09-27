import type { TranslateRequest, TranslationChunk, TranslationSnapshot } from '@muna/contracts';
import { emit } from '@tauri-apps/api/event';

import type { IpcHandlers } from '../../storybook/ipc';
import { refuse } from '../../storybook/ipc';

export interface StoryTranslator {
  /** The snapshot the panel and pane start from. */
  snapshot?: Partial<TranslationSnapshot>;
  /** What every request answers, in pieces; the default is a German greeting. */
  pieces?: readonly string[];
  /** Milliseconds between pieces (a story pace, not motion). */
  paceMs?: number;
  /** End the stream with this error instead of a clean `done`. */
  failWith?: TranslationChunk['error'];
  /** Refuse every request up front with this IPC code (`translation.noKey`, …). */
  refuseWith?: string;
}

const DEFAULT_PIECES = ['Hallo', ' Welt,', ' schön', ' dich', ' zu', ' sehen.'] as const;

/**
 * A fake translation service for the stories: `translate` answers an id and then streams the
 * pieces as `translation-chunk-event`s through the mocked event plugin, exactly the shape Rust
 * emits; `translation_cancel` stops the stream so nothing more arrives. Timers live only while a
 * story streams.
 */
export const translationService = (options: StoryTranslator = {}): IpcHandlers => {
  const snapshot: TranslationSnapshot = {
    enabled: true,
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hasKey: true,
    needsKey: true,
    active: 0,
    ...options.snapshot,
  };
  const pieces = options.pieces ?? DEFAULT_PIECES;
  const pace = options.paceMs ?? 180;
  let nextId = 1;
  const running = new Map<number, ReturnType<typeof setTimeout>>();

  const send = (chunk: TranslationChunk) => {
    void emit('translation-chunk-event', { chunk });
  };

  const stream = (id: number, index: number) => {
    const timer = setTimeout(() => {
      running.delete(id);
      const text = pieces[index];
      if (text === undefined) {
        send({ requestId: id, text: '', done: true, error: options.failWith ?? null });
        return;
      }
      send({ requestId: id, text, done: false, error: null });
      stream(id, index + 1);
    }, pace);
    running.set(id, timer);
  };

  return {
    get_translation_snapshot: () => snapshot,
    translate: (args) => {
      if (options.refuseWith !== undefined) {
        return refuse(options.refuseWith, 'refused by the story');
      }
      const { request } = args as { request: TranslateRequest };
      if (request.text.trim() === '') return refuse('translation.empty', 'nothing to translate');
      const id = nextId;
      nextId += 1;
      stream(id, 0);
      return id;
    },
    translation_cancel: (args) => {
      const { requestId } = args as { requestId: number };
      const timer = running.get(requestId);
      if (timer !== undefined) {
        clearTimeout(timer);
        running.delete(requestId);
      }
      return null;
    },
    translation_copy: () => null,
    translation_set_key: () => ({ ...snapshot, hasKey: true }),
    translation_clear_key: () => ({ ...snapshot, hasKey: false }),
    open_settings: () => null,
  };
};
