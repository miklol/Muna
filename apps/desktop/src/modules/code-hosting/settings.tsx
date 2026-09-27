import {
  CODE_HOSTING_MAX_TOKEN_CHARS,
  type CodeHostingSettings,
  type CodeHostingSnapshot,
  readCodeHostingSettings,
  writeCodeHostingSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Button, ListRow, Text, TextField } from '@muna/ui';
import { ExternalLink, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Section, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { useCodeHostingStore } from './code-hosting-store';
import { initialOf, providerKey } from './format';
import {
  connect,
  type ConnectFailure,
  disconnect,
  openTokenPage,
  useCodeHostingSubscription,
} from './use-code-hosting';
import './code-hosting-settings.css';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const failureKey: Readonly<Record<ConnectFailure, MessageKey>> = {
  disabled: 'codeHosting.settings.connectFailed.disabled',
  empty: 'codeHosting.settings.connectFailed.empty',
  malformed: 'codeHosting.settings.connectFailed.malformed',
  offline: 'codeHosting.settings.connectFailed.offline',
  unauthorized: 'codeHosting.settings.connectFailed.unauthorized',
  rateLimited: 'codeHosting.settings.connectFailed.rateLimited',
  provider: 'codeHosting.settings.connectFailed.provider',
  vault: 'codeHosting.settings.connectFailed.vault',
  failed: 'codeHosting.settings.connectFailed.failed',
};

type ConnectState =
  { phase: 'idle' } | { phase: 'connecting' } | { phase: 'failed'; failure: ConnectFailure };

interface ConnectFormProps {
  /** The module is off: the form explains instead of sending anything. */
  disabled: boolean;
  onConnected: (snapshot: CodeHostingSnapshot) => void;
}

/**
 * The form that connects an account: a masked token field, a button that opens the host's
 * new-token page with the right scopes, and *Connect*. The token goes to Rust once and is
 * cleared from the field whatever the answer; a refusal is explained under the form.
 */
export function ConnectForm({ disabled, onConnected }: ConnectFormProps) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [state, setState] = useState<ConnectState>({ phase: 'idle' });

  const submit = () => {
    const trimmed = token.trim();
    if (trimmed === '') return;
    if (disabled) {
      setState({ phase: 'failed', failure: 'disabled' });
      return;
    }
    setState({ phase: 'connecting' });
    void connect(trimmed).then((outcome) => {
      setToken('');
      if (outcome.status === 'ok') {
        setState({ phase: 'idle' });
        onConnected(outcome.snapshot);
      } else {
        setState({ phase: 'failed', failure: outcome.failure });
      }
    });
  };

  let feedback: string | null = null;
  if (state.phase === 'connecting') feedback = t('codeHosting.settings.connecting');
  else if (state.phase === 'failed') feedback = t(failureKey[state.failure]);

  return (
    <div className="code-hosting-connect">
      <div className="code-hosting-connect__heading">
        <Text as="span" variant="footnote" weight={600}>
          {t('codeHosting.settings.connect')}
        </Text>
        <Text as="span" variant="caption" tone="secondary">
          {t('codeHosting.settings.connectBody')}
        </Text>
      </div>
      <div className="code-hosting-connect__row">
        <TextField
          aria-label={t('codeHosting.settings.token')}
          placeholder={t('codeHosting.settings.tokenPlaceholder')}
          className="code-hosting-connect__token"
          leading={<KeyRound size={16} strokeWidth={1.75} aria-hidden focusable={false} />}
          secret
          maxLength={CODE_HOSTING_MAX_TOKEN_CHARS}
          value={token}
          onChange={setToken}
          onSubmit={submit}
        />
        <Button
          variant="primary"
          isDisabled={state.phase === 'connecting' || token.trim() === ''}
          onPress={submit}
        >
          {t('codeHosting.settings.connectAction')}
        </Button>
      </div>
      <div className="code-hosting-connect__row">
        <Button
          variant="secondary"
          icon={<ExternalLink strokeWidth={1.75} />}
          onPress={() => {
            void openTokenPage();
          }}
        >
          {t('codeHosting.settings.createToken')}
        </Button>
        {feedback !== null && (
          <Text
            as="p"
            variant="footnote"
            tone="secondary"
            role="status"
            className="code-hosting-connect__note"
          >
            {feedback}
          </Text>
        )}
      </div>
    </div>
  );
}

/**
 * Settings → Code hosting (docs/modules/code-hosting.md): what leaves the PC and where the
 * token is kept, the switch, then either the connect form or the connected account with
 * *Disconnect*, and the two strip notices.
 */
export function CodeHostingSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useCodeHostingSubscription();
  const snapshot = useCodeHostingStore((store) => store.snapshot);
  const setSnapshot = useCodeHostingStore((store) => store.setSnapshot);
  const codeHosting = readCodeHostingSettings(settings);

  const write = (recipe: (current: CodeHostingSettings) => CodeHostingSettings) => {
    update((current) =>
      writeCodeHostingSettings(current, recipe(readCodeHostingSettings(current))),
    );
  };

  const account = snapshot?.account ?? null;
  const accountRow =
    account === null ? (
      <div className="code-hosting-connect__frame">
        <ConnectForm disabled={!codeHosting.enabled} onConnected={setSnapshot} />
      </div>
    ) : (
      <ListRow
        icon={
          <span className="code-hosting-account__avatar" aria-hidden>
            {initialOf(account.login)}
          </span>
        }
        label={t('codeHosting.settings.connected', { login: account.login })}
        description={t('codeHosting.settings.connectedBody', {
          provider: t(providerKey[account.provider]),
        })}
        trailingIsControl
        trailing={
          <Button
            variant="secondary"
            onPress={() => {
              void disconnect().then((remaining) => {
                if (remaining !== null) setSnapshot(remaining);
              });
            }}
          >
            {t('codeHosting.settings.disconnect')}
          </Button>
        }
      />
    );

  return (
    <>
      <Section
        title={t('codeHosting.settings.section')}
        description={t('codeHosting.settings.privacy')}
        visible={everything}
        rows={[
          {
            id: 'codeHosting.enabled',
            node: (
              <ToggleRow
                label={t('codeHosting.settings.enabled')}
                description={t('codeHosting.settings.enabledBody')}
                isSelected={codeHosting.enabled}
                onChange={(enabled) => {
                  write((current) => ({ ...current, enabled }));
                }}
              />
            ),
          },
          { id: 'codeHosting.account', node: accountRow },
        ]}
      />
      <Section
        title={t('codeHosting.settings.notices')}
        visible={everything}
        rows={[
          {
            id: 'codeHosting.reviewRequested',
            node: (
              <ToggleRow
                label={t('codeHosting.settings.reviewRequested')}
                description={t('codeHosting.settings.reviewRequestedBody')}
                isSelected={codeHosting.notices.reviewRequested}
                onChange={(reviewRequested) => {
                  write((current) => ({
                    ...current,
                    notices: { ...current.notices, reviewRequested },
                  }));
                }}
              />
            ),
          },
          {
            id: 'codeHosting.checksFinished',
            node: (
              <ToggleRow
                label={t('codeHosting.settings.checksFinished')}
                description={t('codeHosting.settings.checksFinishedBody')}
                isSelected={codeHosting.notices.checksFinished}
                onChange={(checksFinished) => {
                  write((current) => ({
                    ...current,
                    notices: { ...current.notices, checksFinished },
                  }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
