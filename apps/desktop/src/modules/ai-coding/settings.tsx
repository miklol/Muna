import {
  AI_CODING_BOUNDS,
  type AiCodingSettings,
  readAiCodingSettings,
  writeAiCodingSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Button, Text, TextField } from '@muna/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useAiCodingStore } from './ai-coding-store';
import { type AiCodingFailure, useAiCodingCommand, useAiCodingSubscription } from './use-ai-coding';
import './ai-coding-settings.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const failureKey: Readonly<Record<AiCodingFailure, MessageKey>> = {
  unknown: 'aiCoding.error.unknown',
  notWaiting: 'aiCoding.error.notWaiting',
  noProfile: 'aiCoding.error.noProfile',
  hooksFile: 'aiCoding.error.hooksFile',
  io: 'aiCoding.error.io',
  failed: 'aiCoding.error.failed',
};

/** The port as typed, or `null` when it is not a whole number the receiver could bind. */
export const parsePort = (text: string): number | null => {
  const trimmed = text.trim();
  if (!/^\d{1,5}$/u.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= AI_CODING_BOUNDS.port.min && port <= AI_CODING_BOUNDS.port.max ? port : null;
};

interface PortFieldProps {
  port: number;
  onCommit: (port: number) => void;
}

/**
 * The receiver's port: typed freely, committed on Enter or when focus leaves. An entry outside
 * the range (or not a number) is dropped and the field goes back to the saved port, so the
 * settings document never holds a port the receiver could not bind.
 */
function PortField({ port, onCommit }: PortFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    const parsed = parsePort(text);
    if (parsed !== null && parsed !== port) onCommit(parsed);
    setDraft(null);
  };
  return (
    <TextField
      aria-label={t('aiCoding.settings.port')}
      className="ai-coding-settings__port"
      inputMode="numeric"
      autoComplete="off"
      value={draft ?? String(port)}
      onChange={setDraft}
      onBlur={() => {
        if (draft !== null) commit(draft);
      }}
      onSubmit={commit}
    />
  );
}

type HooksFeedback =
  { kind: 'installed' } | { kind: 'removed' } | { kind: 'failed'; failure: AiCodingFailure };

/**
 * Settings → AI coding (docs/modules/ai-coding.md): what is read and where hooks arrive, the
 * switches, then the hook receiver — its port, whether it listens, the URL agents post to,
 * and one button that writes or removes our hooks in Claude Code's settings file.
 */
export function AiCodingSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useAiCodingSubscription();
  const snapshot = useAiCodingStore((store) => store.snapshot);
  const send = useAiCodingCommand();
  const aiCoding = readAiCodingSettings(settings);
  const [feedback, setFeedback] = useState<HooksFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const write = (recipe: (current: AiCodingSettings) => AiCodingSettings) => {
    update((current) => writeAiCodingSettings(current, recipe(readAiCodingSettings(current))));
  };

  const receiver = snapshot?.receiver ?? null;
  const installed = receiver?.claudeHooksInstalled ?? false;
  const toggleHooks = () => {
    setBusy(true);
    setFeedback(null);
    void send({ kind: installed ? 'removeClaudeHooks' : 'installClaudeHooks' })
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setFeedback({ kind: installed ? 'removed' : 'installed' });
        } else {
          setFeedback({ kind: 'failed', failure: outcome.failure });
        }
      })
      .finally(() => {
        setBusy(false);
      });
  };

  let hooksDescription: string;
  if (feedback === null) {
    hooksDescription = installed
      ? t('aiCoding.settings.claudeInstalledBody')
      : t('aiCoding.settings.claudeMissingBody');
  } else if (feedback.kind === 'failed') {
    hooksDescription = t(failureKey[feedback.failure]);
  } else {
    hooksDescription = t(`aiCoding.settings.${feedback.kind}`);
  }

  const listening = receiver?.listening === true;
  const listeningLabel =
    receiver?.listening === true
      ? t('aiCoding.settings.listening', { port: receiver.port })
      : t('aiCoding.settings.notListening');
  const listeningRow = (
    <ValueRow
      label={listeningLabel}
      {...(listening ? {} : { description: t('aiCoding.settings.notListeningBody') })}
      value={
        <span
          className="ai-coding-settings__state"
          data-listening={listening || undefined}
          role="img"
          aria-label={listeningLabel}
        />
      }
    />
  );

  return (
    <>
      <Section
        title={t('aiCoding.settings.section')}
        description={t('aiCoding.settings.privacy')}
        visible={everything}
        rows={[
          {
            id: 'aiCoding.enabled',
            node: (
              <ToggleRow
                label={t('aiCoding.settings.enabled')}
                description={t('aiCoding.settings.enabledBody')}
                isSelected={aiCoding.enabled}
                onChange={(enabled) => {
                  write((current) => ({ ...current, enabled }));
                }}
              />
            ),
          },
          {
            id: 'aiCoding.copilotCli',
            node: (
              <ToggleRow
                label={t('aiCoding.settings.copilotCli')}
                description={t('aiCoding.settings.copilotCliBody')}
                isSelected={aiCoding.copilotCli}
                onChange={(copilotCli) => {
                  write((current) => ({ ...current, copilotCli }));
                }}
              />
            ),
          },
          {
            id: 'aiCoding.waitingNotice',
            node: (
              <ToggleRow
                label={t('aiCoding.settings.waitingNotice')}
                description={t('aiCoding.settings.waitingNoticeBody')}
                isSelected={aiCoding.waitingNotice}
                onChange={(waitingNotice) => {
                  write((current) => ({ ...current, waitingNotice }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('aiCoding.settings.receiver')}
        description={t('aiCoding.settings.receiverBody')}
        visible={everything}
        rows={[
          {
            id: 'aiCoding.port',
            node: (
              <ActionRow
                label={t('aiCoding.settings.port')}
                description={t('aiCoding.settings.portBody', {
                  min: AI_CODING_BOUNDS.port.min,
                  max: AI_CODING_BOUNDS.port.max,
                })}
                action={
                  <PortField
                    port={aiCoding.port}
                    onCommit={(port) => {
                      write((current) => ({ ...current, port }));
                    }}
                  />
                }
              />
            ),
          },
          { id: 'aiCoding.listening', node: listeningRow },
          {
            id: 'aiCoding.hookUrl',
            node: (
              <ValueRow
                label={t('aiCoding.settings.hookUrl')}
                description={t('aiCoding.settings.hookUrlBody')}
                value={
                  <Text
                    as="span"
                    variant="caption"
                    tone="secondary"
                    tabular
                    truncate={1}
                    className="ai-coding-settings__url"
                  >
                    {receiver?.hookUrl ?? '—'}
                  </Text>
                }
              />
            ),
          },
          {
            id: 'aiCoding.claudeHooks',
            node: (
              <ActionRow
                label={t('aiCoding.settings.claude')}
                description={hooksDescription}
                action={
                  <Button
                    variant="secondary"
                    isDisabled={busy || receiver === null || !aiCoding.enabled}
                    onPress={toggleHooks}
                  >
                    {installed ? t('aiCoding.settings.remove') : t('aiCoding.settings.install')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'aiCoding.generic',
            node: (
              <ValueRow
                label={t('aiCoding.settings.generic')}
                description={t('aiCoding.settings.genericBody')}
                value={null}
              />
            ),
          },
        ]}
      />
    </>
  );
}
