import { SUPPORTED_LOCALES, SYSTEM_LANGUAGE, localeDisplayName, localeStatus } from '@muna/i18n';
import { Button, OptionTiles } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { resolveLocale } from '../../lib/locale';
import { ActionRow, type RowFilter, Section, ToggleRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';

interface PaneProps {
  visible: RowFilter;
  /** General → Welcome tour → Show again. */
  onShowTour: () => void;
}

interface LanguageTilesProps {
  value: string;
  onChange: (language: string) => void;
}

/**
 * Windows plus every catalog, each named in its own language so a reader who cannot read the
 * current one still finds theirs. Drafts say so on the tile; the Windows tile names the
 * catalog it currently resolves to, which is English when Windows speaks a language Muna
 * does not have yet.
 */
function LanguageTiles({ value, onChange }: LanguageTilesProps) {
  const { t } = useTranslation();
  const followed = resolveLocale(SYSTEM_LANGUAGE, undefined).catalog;
  const items = [
    {
      id: SYSTEM_LANGUAGE,
      title: t('settings.general.languageSystem'),
      description: t('settings.general.languageSystemBody', {
        name: localeDisplayName(followed),
      }),
    },
    ...SUPPORTED_LOCALES.map((tag) => ({
      id: tag,
      title: localeDisplayName(tag),
      description:
        localeStatus(tag) === 'source'
          ? t('settings.general.languageSource')
          : t('settings.general.languageDraft'),
    })),
  ];
  const known = items.some((item) => item.id === value);
  return (
    <OptionTiles
      aria-label={t('settings.general.language')}
      items={items}
      value={known ? value : SYSTEM_LANGUAGE}
      onChange={onChange}
      columns={3}
    />
  );
}

/** General: launch at login, language, capture privacy, the tour. Shortcuts live in their own pane. */
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
        title={t('settings.general.language')}
        description={t('settings.general.languageBody')}
        visible={visible}
        rows={[
          {
            id: 'general.language',
            node: (
              <div className="px-3 py-2.5">
                <LanguageTiles
                  value={settings.general.language}
                  onChange={(language) => {
                    update((current) => ({
                      ...current,
                      general: { ...current.general, language },
                    }));
                  }}
                />
              </div>
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
