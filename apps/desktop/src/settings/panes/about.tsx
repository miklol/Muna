import type { AppInfo, Settings } from '@muna/contracts';
import { commands, defaultSettings } from '@muna/contracts';
import { Button, Text } from '@muna/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { unwrap } from '../../lib/ipc';
import { sameJson } from '../../lib/json';
import { cacheSettings } from '../../lib/settings';
import { ActionRow, type RowFilter, Section, ValueRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';

export const appInfoQuery = {
  queryKey: ['app-info'] as const,
  queryFn: () => commands.appInfo(),
};

interface PaneProps {
  visible: RowFilter;
}

interface AboutRowsProps {
  info: AppInfo | undefined;
  visible: RowFilter;
}

function AboutSection({ info, visible }: AboutRowsProps) {
  const { t } = useTranslation();
  return (
    <Section
      title={t('settings.about.app')}
      visible={visible}
      rows={[
        {
          id: 'about.version',
          node: (
            <ValueRow
              label={t('settings.about.versionLabel')}
              value={
                <span data-testid="version">
                  {info === undefined ? t('settings.loading') : info.version}
                </span>
              }
            />
          ),
        },
        {
          id: 'about.platform',
          node: <ValueRow label={t('settings.about.platform')} value={info?.platform ?? '—'} />,
        },
        {
          id: 'about.profile',
          node: (
            <ValueRow
              label={t('settings.about.profile')}
              value={
                <Text
                  as="span"
                  variant="footnote"
                  tone="secondary"
                  truncate={1}
                  className="max-w-72"
                >
                  {info?.profileDir ?? '—'}
                </Text>
              }
            />
          ),
        },
      ]}
    />
  );
}

interface Outcome {
  tone: 'ok' | 'error';
  message: string;
}

/**
 * Backup and diagnostics. Export and import open native dialogs from Rust
 * (`export_settings` / `import_settings`), so the UI only reports the outcome; reset writes
 * the contract's defaults through the normal editor path.
 */
export function AboutPane({ visible }: PaneProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const info = useQuery(appInfoQuery);
  const { settings, update } = useSettingsEditor();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const failed = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setOutcome({ tone: 'error', message: t('settings.about.failed', { message }) });
  };

  const exportSettings = useMutation({
    mutationFn: async () => unwrap(await commands.exportSettings()),
    onSuccess: (path) => {
      if (path !== null) {
        setOutcome({ tone: 'ok', message: t('settings.about.exported', { path }) });
      }
    },
    onError: failed,
  });

  const importSettings = useMutation({
    mutationFn: async () => unwrap(await commands.importSettings()),
    onSuccess: (imported: Settings | null) => {
      if (imported !== null) {
        cacheSettings(queryClient, imported);
        setOutcome({ tone: 'ok', message: t('settings.about.imported') });
      }
    },
    onError: failed,
  });

  const openLogs = useMutation({
    mutationFn: async () => unwrap(await commands.openLogsFolder()),
    onError: failed,
  });

  /** Defaults for this profile: module data and the finished tour are not settings to reset. */
  const resetTarget = (current: Settings): Settings => {
    const defaults = defaultSettings();
    return {
      ...defaults,
      general: { ...defaults.general, onboarded: current.general.onboarded },
      modules: current.modules,
    };
  };

  const resetAll = () => {
    setConfirmingReset(false);
    update(resetTarget);
    setOutcome(null);
  };

  const isDefault = sameJson(settings, resetTarget(settings));

  return (
    <>
      <AboutSection info={info.data} visible={visible} />
      <Section
        title={t('settings.about.diagnostics')}
        visible={visible}
        rows={[
          {
            id: 'about.logs',
            node: (
              <ActionRow
                label={t('settings.about.openLogs')}
                description={t('settings.about.openLogsBody')}
                action={
                  <Button
                    isPending={openLogs.isPending}
                    onPress={() => {
                      openLogs.mutate();
                    }}
                  >
                    {t('settings.about.open')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      <Section
        title={t('settings.about.backup')}
        visible={visible}
        rows={[
          {
            id: 'about.export',
            node: (
              <ActionRow
                label={t('settings.about.export')}
                description={t('settings.about.exportBody')}
                action={
                  <Button
                    isPending={exportSettings.isPending}
                    onPress={() => {
                      exportSettings.mutate();
                    }}
                  >
                    {t('settings.about.export')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'about.import',
            node: (
              <ActionRow
                label={t('settings.about.import')}
                description={t('settings.about.importBody')}
                action={
                  <Button
                    isPending={importSettings.isPending}
                    onPress={() => {
                      importSettings.mutate();
                    }}
                  >
                    {t('settings.about.import')}
                  </Button>
                }
              />
            ),
          },
          {
            id: 'about.reset',
            node: confirmingReset ? (
              <ActionRow
                label={t('settings.about.resetQuestion')}
                action={
                  <>
                    <Button
                      onPress={() => {
                        setConfirmingReset(false);
                      }}
                    >
                      {t('settings.about.cancel')}
                    </Button>
                    <Button variant="destructive" onPress={resetAll}>
                      {t('settings.about.resetConfirm')}
                    </Button>
                  </>
                }
              />
            ) : (
              <ActionRow
                label={t('settings.about.reset')}
                description={t('settings.about.resetBody')}
                action={
                  <Button
                    variant="destructive"
                    isDisabled={isDefault}
                    onPress={() => {
                      setConfirmingReset(true);
                    }}
                  >
                    {t('settings.about.reset')}
                  </Button>
                }
              />
            ),
          },
        ]}
      />
      {outcome !== null && (
        <Text
          as="p"
          role="status"
          variant="footnote"
          tone={outcome.tone === 'error' ? 'primary' : 'secondary'}
          className="px-3"
        >
          {outcome.message}
        </Text>
      )}
    </>
  );
}
