import { Button } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, Keys, type RowFilter, Section, ToggleRow, ValueRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';

interface PaneProps {
  visible: RowFilter;
  /** General → Welcome tour → Show again. */
  onShowTour: () => void;
}

/** General: launch at login, capture privacy, the toggle shortcut (read-only for now), the tour. */
export function GeneralPane({ visible, onShowTour }: PaneProps) {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();

  return (
    <>
      <Section
        title={t('settings.general.startup')}
        visible={visible}
        rows={[
          {
            id: 'general.launchAtLogin',
            node: (
              <ToggleRow
                label={t('settings.general.launchAtLogin')}
                description={t('settings.general.launchAtLoginBody')}
                isSelected={settings.general.launchAtLogin}
                onChange={(launchAtLogin) => {
                  update((current) => ({
                    ...current,
                    general: { ...current.general, launchAtLogin },
                  }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('settings.general.privacy')}
        visible={visible}
        rows={[
          {
            id: 'general.hideFromCaptures',
            node: (
              <ToggleRow
                label={t('settings.general.hideFromCaptures')}
                description={t('settings.general.hideFromCapturesBody')}
                isSelected={settings.shell.hideFromCaptures}
                onChange={(hideFromCaptures) => {
                  update((current) => ({
                    ...current,
                    shell: { ...current.shell, hideFromCaptures },
                  }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('settings.general.keyboard')}
        visible={visible}
        rows={[
          {
            id: 'general.toggleHotkey',
            node: (
              <ValueRow
                label={t('settings.general.toggleHotkey')}
                description={t('settings.general.toggleHotkeyBody')}
                value={<Keys shortcut={settings.shell.toggleHotkey} />}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('settings.general.help')}
        visible={visible}
        rows={[
          {
            id: 'general.tour',
            node: (
              <ActionRow
                label={t('settings.general.tour')}
                description={t('settings.general.tourBody')}
                action={<Button onPress={onShowTour}>{t('settings.general.tourShow')}</Button>}
              />
            ),
          },
        ]}
      />
    </>
  );
}
