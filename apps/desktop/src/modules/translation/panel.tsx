import type { MessageKey } from '@muna/i18n';
import {
  commands,
  defaultSettings,
  readTranslationSettings,
  TRANSLATION_AUTO,
  TRANSLATION_BOUNDS,
  translationEndpointOf,
  translationHostOf,
  translationModelOf,
  type TranslationSettings,
  writeTranslationSettings,
} from '@muna/contracts';
import {
  Button,
  contentRecipe,
  EmptyState,
  IconButton,
  Text,
  TextArea,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowLeftRight, Check, Copy, Languages, Settings2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { persistSettings, useSettings } from '../../lib/settings';
import { LanguageList } from './language-list';
import { languageName } from './languages';
import './translation.css';
import { idleResult, type TranslationFailure, useTranslationStore } from './translation-store';
import { copyTranslation, useTranslationSubscription, useTranslator } from './use-translator';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** How long *Copied* stands in the footer before the consent line returns. Not motion. */
export const COPIED_MS = 1500;

const failureKey: Readonly<Record<TranslationFailure, MessageKey>> = {
  disabled: 'translation.error.disabled',
  empty: 'translation.error.empty',
  tooLong: 'translation.error.tooLong',
  noKey: 'translation.error.noKey',
  endpoint: 'translation.error.endpoint',
  vault: 'translation.error.vault',
  offline: 'translation.error.offline',
  unauthorized: 'translation.error.unauthorized',
  rateLimited: 'translation.error.rateLimited',
  modelMissing: 'translation.error.modelMissing',
  provider: 'translation.error.provider',
  failed: 'translation.error.failed',
};

const openSettings = () => {
  void commands.openSettings().catch(() => {
    // Outside Tauri (tests, Storybook) there is no settings window.
  });
};

/** The number of characters `text` counts for the request bound (code points, like Rust). */
export const charCount = (text: string): number => Array.from(text).length;

type View = 'translate' | 'source' | 'target';

/**
 * The translation panel (docs/modules/translation.md): the language pair in the head, the text
 * to translate, the answer streaming in under it, and one line that says where the text goes.
 * Languages are picked from a searchable list that takes the panel over until one is chosen;
 * the pair is saved as the module's default. A request still running when the pair changes,
 * the panel collapses or the module switches is cancelled.
 */
export function TranslationPanel() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const queryClient = useQueryClient();
  const document = useSettings() ?? defaultSettings();
  const settings = readTranslationSettings(document);
  useTranslationSubscription();
  const snapshot = useTranslationStore((store) => store.snapshot);
  const draft = useTranslationStore((store) => store.draft);
  const setDraft = useTranslationStore((store) => store.setDraft);
  const result = useTranslationStore((store) => store.result);
  const setResult = useTranslationStore((store) => store.setResult);
  const focusRequested = useTranslationStore((store) => store.focusRequested);
  const clearFocusRequest = useTranslationStore((store) => store.clearFocusRequest);
  const { translate, cancel } = useTranslator();
  const [view, setView] = useState<View>('translate');
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const reduceMotion = useReduceMotion();
  const enterSpring = useMotionPreset('content');

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // The *Translate text* action opened the panel: the caret goes to the source box once it is up.
  useEffect(() => {
    if (!focusRequested) return;
    if (sourceRef.current !== null) {
      sourceRef.current.focus();
      clearFocusRequest();
    }
  }, [focusRequested, clearFocusRequest, view]);

  const write = (recipe: (current: TranslationSettings) => TranslationSettings) => {
    persistSettings(queryClient, writeTranslationSettings(document, recipe(settings)));
  };

  const endpoint = snapshot?.endpoint ?? translationEndpointOf(settings);
  const host = translationHostOf(endpoint);
  const model = snapshot?.model ?? translationModelOf(settings);
  const keyMissing = snapshot !== null && snapshot.needsKey && !snapshot.hasKey;
  const running = result.phase === 'running';
  const count = charCount(draft);
  const tooLong = count > TRANSLATION_BOUNDS.text.max;
  const canTranslate = draft.trim() !== '' && !tooLong && !keyMissing;

  const nameOf = (tag: string) =>
    tag === TRANSLATION_AUTO ? t('translation.auto') : languageName(tag, locale);

  const run = () => {
    if (!canTranslate) return;
    setCopied(false);
    translate({ text: draft.trim(), source: settings.source, target: settings.target });
  };

  const choose = (side: 'source' | 'target', tag: string) => {
    if (running) cancel();
    write((current) =>
      side === 'source' ? { ...current, source: tag } : { ...current, target: tag },
    );
    setView('translate');
  };

  const swap = () => {
    if (settings.source === TRANSLATION_AUTO) return;
    if (running) cancel();
    const carried = result.phase === 'done' && result.output !== '' ? result.output : null;
    write((current) => ({ ...current, source: current.target, target: current.source }));
    if (carried !== null) {
      setDraft(carried);
      setResult(idleResult);
    }
  };

  const copy = () => {
    void copyTranslation(result.output).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => {
        setCopied(false);
      }, COPIED_MS);
    });
  };

  if (!settings.enabled) {
    return (
      <motion.div
        className="translation-panel"
        data-status="off"
        initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
        animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
        transition={enterSpring}
      >
        <EmptyState
          className="translation-state"
          icon={<Languages size={24} strokeWidth={1.5} />}
          title={t('translation.state.offTitle')}
          description={t('translation.state.offBody')}
          action={
            <Button variant="secondary" onPress={openSettings}>
              {t('translation.state.openSettings')}
            </Button>
          }
        />
      </motion.div>
    );
  }

  if (view !== 'translate') {
    const side = view;
    return (
      <div className="translation-panel" data-view={side}>
        <div className="translation-head">
          <IconButton
            aria-label={t('translation.head.back')}
            onPress={() => {
              setView('translate');
            }}
          >
            <ArrowLeft strokeWidth={ICON_STROKE} />
          </IconButton>
          <Text as="h2" variant="footnote" weight={600} className="translation-head__title">
            {side === 'source' ? t('translation.head.from') : t('translation.head.to')}
          </Text>
        </div>
        <LanguageList
          value={side === 'source' ? settings.source : settings.target}
          allowAuto={side === 'source'}
          focusOnMount
          onChange={(tag) => {
            choose(side, tag);
          }}
        />
      </div>
    );
  }

  let note: string;
  if (copied) {
    note = t('translation.output.copied');
  } else if (result.phase === 'failed' && result.failure !== null) {
    note = t(failureKey[result.failure], {
      host,
      model,
      max: new Intl.NumberFormat(locale).format(TRANSLATION_BOUNDS.text.max),
    });
  } else if (running) {
    note = t('translation.footer.translating');
  } else if (result.phase === 'done') {
    note = t('translation.footer.done');
  } else if (keyMissing) {
    note = t('translation.footer.noKey');
  } else if (tooLong) {
    note = t('translation.footer.tooLong', {
      max: new Intl.NumberFormat(locale).format(TRANSLATION_BOUNDS.text.max),
    });
  } else {
    note = t('translation.footer.consent', { host });
  }

  const outputEmpty = result.output === '';
  let outputText: string;
  if (!outputEmpty) {
    outputText = result.output;
  } else if (running) {
    outputText = t('translation.output.translating');
  } else {
    outputText = t('translation.output.placeholder');
  }

  return (
    <motion.div
      className="translation-panel"
      data-status={result.phase}
      initial={reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge}
      animate={reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible}
      transition={enterSpring}
    >
      <div className="translation-head">
        <span className="translation-head__glyph" aria-hidden="true">
          <Languages size={16} strokeWidth={ICON_STROKE} />
        </span>
        <Button
          variant="secondary"
          className="translation-pair__language"
          aria-label={t('translation.head.fromLanguage', { language: nameOf(settings.source) })}
          onPress={() => {
            setView('source');
          }}
        >
          {nameOf(settings.source)}
        </Button>
        <IconButton
          aria-label={t('translation.head.swap')}
          isDisabled={settings.source === TRANSLATION_AUTO}
          onPress={swap}
        >
          <ArrowLeftRight strokeWidth={ICON_STROKE} />
        </IconButton>
        <Button
          variant="secondary"
          className="translation-pair__language"
          aria-label={t('translation.head.toLanguage', { language: nameOf(settings.target) })}
          onPress={() => {
            setView('target');
          }}
        >
          {nameOf(settings.target)}
        </Button>
        <span className="translation-head__spacer" />
        <IconButton aria-label={t('translation.head.settings')} onPress={openSettings}>
          <Settings2 strokeWidth={ICON_STROKE} />
        </IconButton>
      </div>
      <TextArea
        aria-label={t('translation.source.label')}
        placeholder={t('translation.source.placeholder')}
        className="translation-source"
        textAreaRef={sourceRef}
        value={draft}
        onChange={setDraft}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            run();
          }
        }}
      />
      <div
        className="translation-output"
        role="region"
        aria-label={t('translation.output.label')}
        aria-busy={running || undefined}
        data-empty={outputEmpty || undefined}
        // Long answers scroll; the region needs a tab stop for keyboard scrolling.
        tabIndex={outputEmpty ? undefined : 0}
      >
        <Text
          as="p"
          variant="body"
          tone={outputEmpty ? 'tertiary' : 'primary'}
          className="translation-output__text"
        >
          {outputText}
        </Text>
      </div>
      <div className="translation-foot">
        <Text
          as="p"
          variant="caption"
          tone={result.phase === 'failed' ? 'primary' : 'secondary'}
          role="status"
          truncate={1}
          className="translation-foot__note"
        >
          {note}
        </Text>
        {!outputEmpty && !running && (
          <IconButton aria-label={t('translation.output.copy')} onPress={copy}>
            {copied ? <Check strokeWidth={ICON_STROKE} /> : <Copy strokeWidth={ICON_STROKE} />}
          </IconButton>
        )}
        {running ? (
          <Button variant="secondary" onPress={cancel}>
            {t('translation.actions.stop')}
          </Button>
        ) : (
          <Button
            variant="primary"
            isDisabled={!canTranslate}
            aria-keyshortcuts="Control+Enter"
            onPress={run}
          >
            {t('translation.actions.translate')}
          </Button>
        )}
      </div>
    </motion.div>
  );
}
