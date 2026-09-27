import {
  formatBytes,
  readSupportSettings,
  type SupportCommand,
  type SupportOutcome,
  type SupportSettings,
  type UpdateChannel,
  writeSupportSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Button, Text } from '@muna/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import { ActionRow, Section, SegmentedRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { bundleName } from './panel';
import { useSupportStore } from './support-store';
import {
  openLink,
  type SupportFailure,
  useSupportCommand,
  useSupportSubscription,
} from './use-support';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const CHANNELS: readonly UpdateChannel[] = ['stable', 'beta'];

const channelKey: Readonly<Record<UpdateChannel, MessageKey>> = {
  stable: 'support.settings.channels.stable',
  beta: 'support.settings.channels.beta',
};

const failureKey: Readonly<Record<SupportFailure, MessageKey>> = {
  noDesktop: 'support.error.noDesktop',
  io: 'support.error.io',
  zip: 'support.error.io',
  updater: 'support.error.updater',
  failed: 'support.error.failed',
};

interface Note {
  tone: 'ok' | 'error';
  text: string;
}

/**
 * Settings → Support (docs/modules/support.md): the update channel and a check for updates —
 * a check only, which names the newer version and points at GitHub; installing waits for the
 * release epic — then the diagnostics bundle with the size of the logs it will carry, the logs
 * folder, and the two repairs. The channel is written into the settings document; Rust reads it
 * back for the updater endpoint.
 */
export function SupportSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useSupportSubscription();
  const snapshot = useSupportStore((store) => store.snapshot);
  const send = useSupportCommand();
  const support = readSupportSettings(settings);
  const locale = useLocale();
  const [busy, setBusy] = useState<SupportCommand['kind'] | null>(null);
  const [updateNote, setUpdateNote] = useState<Note | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const write = (recipe: (current: SupportSettings) => SupportSettings) => {
    update((current) => writeSupportSettings(current, recipe(readSupportSettings(current))));
  };

  const describeUpdate = (outcome: SupportOutcome): Note => {
    if (outcome.kind === 'update' && outcome.available) {
      return {
        tone: 'ok',
        text: t('support.settings.updateAvailable', { version: outcome.version ?? '' }),
      };
    }
    return {
      tone: 'ok',
      text: t('support.settings.upToDate', { version: snapshot?.version ?? '' }),
    };
  };

  /** Runs a command; the update check reports into its own row, everything else under the pane. */
  const run = (command: SupportCommand, done: MessageKey) => {
    const report = command.kind === 'checkUpdates' ? setUpdateNote : setNote;
    setBusy(command.kind);
    report(null);
    void send(command)
      .then((result) => {
        if (result.status === 'error') {
          report({ tone: 'error', text: t(failureKey[result.failure]) });
        } else if (result.outcome.kind === 'update') {
          setUpdateAvailable(result.outcome.available);
          report(describeUpdate(result.outcome));
        } else if (result.outcome.kind === 'bundle') {
          report({
            tone: 'ok',
            text: t('support.diagnostics.saved', { name: bundleName(result.outcome.path) }),
          });
        } else {
          report({ tone: 'ok', text: t(done) });
        }
      })
      .finally(() => {
        setBusy(null);
      });
  };

  const system =
    snapshot === null
      ? t('settings.loading')
      : [
          snapshot.system.os,
          snapshot.system.webview2 === null ? null : `WebView2 ${snapshot.system.webview2}`,
        ]
          .filter((part): part is string => part !== null)
          .join(' · ');
  const logs = snapshot === null ? null : formatBytes(snapshot.logsBytes, locale);

  return (
    <>
      <Section
        title={t('support.settings.updates')}
        visible={everything}
        rows={[
          {
            id: 'support.channel',
            node: (
              <SegmentedRow
                label={t('support.settings.channel')}
                description={t('support.settings.channelBody')}
                items={CHANNELS.map((channel) => ({
                  id: channel,
                  label: t(channelKey[channel]),
                }))}
                value={support.channel}
                onChange={(channel) => {
                  write((current) => ({ ...current, channel }));
                }}
              />
            ),
          },
          {
            id: 'support.check',
            node: (
              <ActionRow
                label={t('support.settings.check')}
                description={
                  updateNote?.text ??
                  t('support.settings.checkBody', { version: snapshot?.version ?? '' })
                }
                action={
                  <>
                    {updateAvailable && (
                      <Button
                        variant="secondary"
                        onPress={() => {
                          void openLink('releaseNotes');
                        }}
                      >
                        {t('support.settings.download')}
                      </Button>
                    )}
                    <Button
                      isPending={busy === 'checkUpdates'}
                      onPress={() => {
                        run({ kind: 'checkUpdates' }, 'support.done');
                      }}
                    >
                      {t('support.settings.checkAction')}
                    </Button>
                  </>
                }
              />
            ),
          },
        ]}
      />
      <Section
        title={t('support.settings.diagnostics')}
        visible={everything}
        rows={[
          {
            id: 'support.system',
            node: <ValueRow label={t('support.settings.system')} value={system} />,
          },
          {
            id: 'support.bundle',
            node: (
              <ActionRow
                label={t('support.diagnostics.title')}
                description={
                  logs === null
                    ? t('support.diagnostics.body')
                    : t('support.settings.bundleBody', { logs })
                }
                action={
                  <Button
                    isPending={busy === 'diagnostics'}
                    onPress={() => {
                      run({ kind: 'diagnostics' }, 'support.done');
                    }}
                  >
                    {t('support.settings.save')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'support.logs',
            node: (
              <ActionRow
                label={t('support.settings.logs')}
                description={t('support.settings.logsBody')}
                action={
                  <Button
                    variant="secondary"
                    isPending={busy === 'openLogs'}
                    onPress={() => {
                      run({ kind: 'openLogs' }, 'support.done');
                    }}
                  >
                    {t('support.settings.open')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      <Section
        title={t('support.repair.title')}
        description={t('support.settings.repairBody')}
        visible={everything}
        rows={[
          {
            id: 'support.repairFlyouts',
            node: (
              <ActionRow
                label={t('support.repair.flyouts')}
                description={t('support.repair.flyoutsBody')}
                action={
                  <Button
                    variant="secondary"
                    isPending={busy === 'repairFlyouts'}
                    onPress={() => {
                      run({ kind: 'repairFlyouts' }, 'support.repair.flyoutsDone');
                    }}
                  >
                    {t('support.repair.action')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'support.repairAppBar',
            node: (
              <ActionRow
                label={t('support.repair.appBar')}
                description={t('support.repair.appBarBody')}
                action={
                  <Button
                    variant="secondary"
                    isPending={busy === 'repairAppBar'}
                    onPress={() => {
                      run({ kind: 'repairAppBar' }, 'support.repair.appBarDone');
                    }}
                  >
                    {t('support.repair.action')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      {note !== null && (
        <Text
          as="p"
          role="status"
          variant="footnote"
          tone={note.tone === 'error' ? 'primary' : 'secondary'}
          className="px-3"
        >
          {note.text}
        </Text>
      )}
    </>
  );
}
