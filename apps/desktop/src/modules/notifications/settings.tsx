import {
  type AccessState,
  type NotificationsSettings,
  readNotificationsSettings,
  writeNotificationsSettings,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { Button } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import './notifications-settings.css';
import { useNotificationsStore } from './notifications-store';
import {
  openWindowsSettings,
  useNotificationsCommand,
  useNotificationsSubscription,
} from './use-notifications';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

const accessKey: Record<AccessState, MessageKey> = {
  allowed: 'notifications.settings.accessState.allowed',
  denied: 'notifications.settings.accessState.denied',
  unspecified: 'notifications.settings.accessState.unspecified',
  unavailable: 'notifications.settings.accessState.unavailable',
};

/**
 * Settings → Notifications (docs/modules/notifications.md): where access stands and the
 * Windows page that changes it, how changes reach Muna on this build, the two strip switches,
 * and the muted senders so they can be unmuted. Muting itself happens from a sender's row in
 * the panel; it is a setting, so it saves like any other and Rust re-emits its snapshot.
 */
export function NotificationsSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  useNotificationsSubscription();
  const snapshot = useNotificationsStore((store) => store.snapshot);
  const pending = useNotificationsStore((store) => store.pending);
  const send = useNotificationsCommand();
  const notifications = readNotificationsSettings(settings);

  const write = (recipe: (current: NotificationsSettings) => NotificationsSettings) => {
    update((current) =>
      writeNotificationsSettings(current, recipe(readNotificationsSettings(current))),
    );
  };
  const unmute = (appId: string) => {
    write((current) => ({
      ...current,
      mutedApps: current.mutedApps.filter((known) => known !== appId),
    }));
  };

  const access = snapshot?.access;
  const asking = pending.has('access');
  const accessAction = (() => {
    switch (access) {
      case 'allowed':
        return (
          <Button
            variant="secondary"
            onPress={() => {
              openWindowsSettings('privacy');
            }}
          >
            {t('notifications.settings.windowsSettings')}
          </Button>
        );
      case 'denied':
        return (
          <span className="ntf-settings__actions">
            <Button
              variant="secondary"
              onPress={() => {
                openWindowsSettings('privacy');
              }}
            >
              {t('notifications.settings.windowsSettings')}
            </Button>
            <Button
              variant="secondary"
              isDisabled={asking}
              onPress={() => {
                send({ kind: 'requestAccess' });
              }}
            >
              {t('notifications.denied.recheck')}
            </Button>
          </span>
        );
      case 'unspecified':
        return (
          <Button
            variant="primary"
            isDisabled={asking}
            onPress={() => {
              send({ kind: 'requestAccess' });
            }}
          >
            {asking ? t('notifications.unspecified.asking') : t('notifications.unspecified.action')}
          </Button>
        );
      case 'unavailable':
      case undefined:
        return null;
    }
  })();

  const accessRows = [
    {
      id: 'notifications.access',
      node: (
        <ActionRow
          label={t('notifications.settings.accessLabel')}
          {...(access === undefined ? {} : { description: t(accessKey[access]) })}
          action={accessAction}
        />
      ),
    },
  ];
  if (snapshot?.delivery === 'polling') {
    accessRows.push({
      id: 'notifications.delivery',
      node: (
        <ValueRow
          label={t('notifications.settings.delivery')}
          description={t('notifications.settings.deliveryPollingBody')}
          value={t('notifications.settings.deliveryPolling')}
        />
      ),
    });
  } else if (snapshot?.delivery === 'push') {
    accessRows.push({
      id: 'notifications.delivery',
      node: (
        <ValueRow
          label={t('notifications.settings.delivery')}
          value={t('notifications.settings.deliveryPush')}
        />
      ),
    });
  }

  const nameOf = (appId: string): string =>
    snapshot?.groups.find((group) => group.appId === appId)?.appName ?? appId;
  const mutedRows =
    notifications.mutedApps.length === 0
      ? [
          {
            id: 'notifications.muted.none',
            node: <ValueRow label={t('notifications.settings.noMutedApps')} value={null} />,
          },
        ]
      : notifications.mutedApps.map((appId) => ({
          id: `notifications.muted.${appId}`,
          node: (
            <ActionRow
              label={nameOf(appId)}
              action={
                <Button
                  variant="secondary"
                  aria-label={t('notifications.unmute', { app: nameOf(appId) })}
                  onPress={() => {
                    unmute(appId);
                  }}
                >
                  {t('notifications.settings.unmute')}
                </Button>
              }
            />
          ),
        }));

  return (
    <>
      <Section title={t('notifications.settings.access')} visible={everything} rows={accessRows} />
      <Section
        title={t('notifications.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'notifications.arrivalNotices',
            node: (
              <ToggleRow
                label={t('notifications.settings.arrivalNotices')}
                description={t('notifications.settings.arrivalNoticesBody')}
                isSelected={notifications.arrivalNotices}
                onChange={(arrivalNotices) => {
                  write((current) => ({ ...current, arrivalNotices }));
                }}
              />
            ),
          },
          {
            id: 'notifications.showUnreadInStrip',
            node: (
              <ToggleRow
                label={t('notifications.settings.showUnreadInStrip')}
                description={t('notifications.settings.showUnreadInStripBody')}
                isSelected={notifications.showUnreadInStrip}
                onChange={(showUnreadInStrip) => {
                  write((current) => ({ ...current, showUnreadInStrip }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('notifications.settings.mutedApps')}
        description={t('notifications.settings.mutedAppsBody')}
        visible={everything}
        rows={mutedRows}
      />
    </>
  );
}
