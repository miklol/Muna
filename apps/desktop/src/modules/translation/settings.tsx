import {
  readTranslationSettings,
  TRANSLATION_AUTO,
  TRANSLATION_BOUNDS,
  TRANSLATION_PROVIDER_DEFAULTS,
  TRANSLATION_PROVIDERS,
  translationEndpointOf,
  translationHostOf,
  translationModelOf,
  type TranslationProvider,
  type TranslationSettings,
  writeTranslationSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Button, ListRow, TextField } from '@muna/ui';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { ActionRow, Section, SegmentedRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { LanguageList } from './language-list';
import { languageName } from './languages';
import './translation.css';
import { useTranslationStore } from './translation-store';
import { type KeyFailure, removeKey, saveKey, useTranslationSubscription } from './use-translator';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const providerKey: Readonly<Record<TranslationProvider, MessageKey>> = {
  openai: 'translation.settings.providerOpenai',
  ollama: 'translation.settings.providerOllama',
};

const keyFailureKey: Readonly<Record<KeyFailure, MessageKey>> = {
  empty: 'translation.settings.keyFailed.empty',
  malformed: 'translation.settings.keyFailed.malformed',
  vault: 'translation.settings.keyFailed.vault',
  failed: 'translation.settings.keyFailed.failed',
};

interface CommitFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onCommit: (value: string) => void;
}

/**
 * A free-text setting typed freely and committed on Enter or when focus leaves, so the
 * document (and the Rust service, which drops a running request when its route changes) sees
 * one change per edit rather than one per keystroke.
 */
function CommitField({ label, placeholder, value, onCommit }: CommitFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const trimmed = text.trim();
    if (trimmed !== value) onCommit(trimmed);
    setDraft(null);
  };
  return (
    <TextField
      aria-label={label}
      className="translation-settings__field"
      placeholder={placeholder}
      autoComplete="off"
      maxLength={TRANSLATION_BOUNDS.field.max}
      value={draft ?? value}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== null) commit(draft);
      }}
      onSubmit={commit}
    />
  );
}

type KeyState = { phase: 'idle' } | { phase: 'busy' } | { phase: 'failed'; failure: KeyFailure };

interface KeyRowProps {
  provider: TranslationProvider;
  /** `null` until the first snapshot; the form waits rather than guess. */
  hasKey: boolean | null;
}

/**
 * The API key row: a masked field and *Save* while none is kept, the fact that one is and
 * *Remove* once it is. The key goes to Rust once and is cleared from the field whatever the
 * answer; a refusal is explained under the row.
 */
function KeyRow({ provider, hasKey }: KeyRowProps) {
  const { t } = useTranslation();
  const setSnapshot = useTranslationStore((store) => store.setSnapshot);
  const [key, setKey] = useState('');
  const [state, setState] = useState<KeyState>({ phase: 'idle' });
  const needsKey = TRANSLATION_PROVIDER_DEFAULTS[provider].needsKey;

  const submit = () => {
    const trimmed = key.trim();
    if (trimmed === '' || state.phase === 'busy') return;
    setState({ phase: 'busy' });
    void saveKey(trimmed).then((outcome) => {
      setKey('');
      if (outcome.status === 'ok') {
        setState({ phase: 'idle' });
        setSnapshot(outcome.snapshot);
      } else {
        setState({ phase: 'failed', failure: outcome.failure });
      }
    });
  };

  const remove = () => {
    setState({ phase: 'busy' });
    void removeKey().then((outcome) => {
      if (outcome.status === 'ok') {
        setState({ phase: 'idle' });
        setSnapshot(outcome.snapshot);
      } else {
        setState({ phase: 'failed', failure: outcome.failure });
      }
    });
  };

  let description: string;
  if (state.phase === 'failed') {
    description = t(keyFailureKey[state.failure]);
  } else if (state.phase === 'busy') {
    description = t('translation.settings.keyBusy');
  } else if (hasKey === true) {
    description = t('translation.settings.keySaved', { provider: t(providerKey[provider]) });
  } else if (needsKey) {
    description = t('translation.settings.keyRequired');
  } else {
    description = t('translation.settings.keyOptional');
  }

  return (
    <ListRow
      icon={<KeyRound strokeWidth={1.75} />}
      label={t('translation.settings.key')}
      description={<span role="status">{description}</span>}
      trailingIsControl
      trailing={
        hasKey === true ? (
          <Button variant="secondary" isDisabled={state.phase === 'busy'} onPress={remove}>
            {t('translation.settings.keyRemove')}
          </Button>
        ) : (
          <span className="translation-settings__key">
            <TextField
              aria-label={t('translation.settings.keyField')}
              placeholder={t('translation.settings.keyPlaceholder')}
              className="translation-settings__field"
              secret
              maxLength={TRANSLATION_BOUNDS.key.max}
              value={key}
              onChange={setKey}
              onSubmit={submit}
              isDisabled={hasKey === null}
            />
            <Button
              variant="primary"
              isDisabled={hasKey === null || state.phase === 'busy' || key.trim() === ''}
              onPress={submit}
            >
              {t('translation.settings.keySave')}
            </Button>
          </span>
        )
      }
    />
  );
}

/**
 * Settings → Translation (docs/modules/translation.md): what leaves the PC and where, the
 * switch, the provider with its endpoint and model, the key, then the default language pair —
 * changed here from the same list the panel uses.
 */
export function TranslationSettingsPane() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings: document, update } = useSettingsEditor();
  useTranslationSubscription();
  const snapshot = useTranslationStore((store) => store.snapshot);
  const settings = readTranslationSettings(document);
  const [picking, setPicking] = useState<'source' | 'target' | null>(null);

  const write = (recipe: (current: TranslationSettings) => TranslationSettings) => {
    update((current) =>
      writeTranslationSettings(current, recipe(readTranslationSettings(current))),
    );
  };

  const defaults = TRANSLATION_PROVIDER_DEFAULTS[settings.provider];
  const host = translationHostOf(translationEndpointOf(settings));
  const nameOf = (tag: string) =>
    tag === TRANSLATION_AUTO ? t('translation.auto') : languageName(tag, locale);

  const languageRow = (side: 'source' | 'target') => {
    const open = picking === side;
    return (
      <ActionRow
        label={side === 'source' ? t('translation.settings.from') : t('translation.settings.to')}
        description={nameOf(side === 'source' ? settings.source : settings.target)}
        action={
          <Button
            variant="secondary"
            aria-expanded={open}
            onPress={() => {
              setPicking(open ? null : side);
            }}
          >
            {open ? t('translation.settings.done') : t('translation.settings.change')}
          </Button>
        }
      />
    );
  };

  const languageList = (side: 'source' | 'target') => (
    <LanguageList
      className="translation-settings__list"
      value={side === 'source' ? settings.source : settings.target}
      allowAuto={side === 'source'}
      onChange={(tag) => {
        write((current) =>
          side === 'source' ? { ...current, source: tag } : { ...current, target: tag },
        );
        setPicking(null);
      }}
    />
  );

  return (
    <>
      <Section
        title={t('translation.settings.section')}
        description={t('translation.settings.privacy')}
        visible={everything}
        rows={[
          {
            id: 'translation.enabled',
            node: (
              <ToggleRow
                label={t('translation.settings.enabled')}
                description={t('translation.settings.enabledBody', { host })}
                isSelected={settings.enabled}
                onChange={(enabled) => {
                  write((current) => ({ ...current, enabled }));
                }}
              />
            ),
          },
          {
            id: 'translation.provider',
            node: (
              <SegmentedRow
                label={t('translation.settings.provider')}
                description={t('translation.settings.providerBody')}
                items={TRANSLATION_PROVIDERS.map((provider) => ({
                  id: provider,
                  label: t(providerKey[provider]),
                }))}
                value={settings.provider}
                onChange={(provider) => {
                  if (provider === settings.provider) return;
                  write((current) => ({ ...current, provider, endpoint: '', model: '' }));
                }}
              />
            ),
          },
          {
            id: 'translation.endpoint',
            node: (
              <ActionRow
                label={t('translation.settings.endpoint')}
                description={t('translation.settings.endpointBody')}
                action={
                  <CommitField
                    label={t('translation.settings.endpoint')}
                    placeholder={defaults.endpoint}
                    value={settings.endpoint}
                    onCommit={(endpoint) => {
                      write((current) => ({ ...current, endpoint }));
                    }}
                  />
                }
              />
            ),
          },
          {
            id: 'translation.model',
            node: (
              <ActionRow
                label={t('translation.settings.model')}
                description={t('translation.settings.modelBody', {
                  model: translationModelOf(settings),
                })}
                action={
                  <CommitField
                    label={t('translation.settings.model')}
                    placeholder={defaults.model}
                    value={settings.model}
                    onCommit={(model) => {
                      write((current) => ({ ...current, model }));
                    }}
                  />
                }
              />
            ),
          },
          {
            id: 'translation.key',
            node: (
              <KeyRow
                key={settings.provider}
                provider={settings.provider}
                hasKey={snapshot === null ? null : snapshot.hasKey}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('translation.settings.languages')}
        description={t('translation.settings.languagesBody')}
        visible={everything}
        rows={[
          { id: 'translation.source', node: languageRow('source') },
          ...(picking === 'source'
            ? [{ id: 'translation.sourceList', node: languageList('source') }]
            : []),
          { id: 'translation.target', node: languageRow('target') },
          ...(picking === 'target'
            ? [{ id: 'translation.targetList', node: languageList('target') }]
            : []),
        ]}
      />
    </>
  );
}
