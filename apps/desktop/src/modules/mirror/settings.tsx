import { type MirrorSettings, readMirrorSettings, writeMirrorSettings } from '@muna/contracts';
import { Button } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → Mirror (docs/modules/mirror.md): whether the camera may be used at all (off by
 * default, with the privacy promise spelled out), whether the picture is mirrored, and which
 * camera the panel opens — chosen from the panel, cleared back to the system default here.
 */
export function MirrorSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const mirror = readMirrorSettings(settings);

  const write = (recipe: (current: MirrorSettings) => MirrorSettings) => {
    update((current) => writeMirrorSettings(current, recipe(readMirrorSettings(current))));
  };

  const deviceDescription =
    mirror.deviceId === null
      ? t('mirror.settings.deviceDefault')
      : t('mirror.settings.deviceChosen', {
          label: mirror.deviceLabel ?? t('mirror.head.defaultCamera'),
        });

  return (
    <Section
      title={t('mirror.settings.camera')}
      visible={everything}
      rows={[
        {
          id: 'mirror.enabled',
          node: (
            <ToggleRow
              label={t('mirror.settings.enabled')}
              description={t('mirror.settings.enabledBody')}
              isSelected={mirror.enabled}
              onChange={(enabled) => {
                write((current) => ({ ...current, enabled }));
              }}
            />
          ),
        },
        {
          id: 'mirror.flip',
          node: (
            <ToggleRow
              label={t('mirror.settings.flip')}
              description={t('mirror.settings.flipBody')}
              isSelected={mirror.flip}
              onChange={(flip) => {
                write((current) => ({ ...current, flip }));
              }}
            />
          ),
        },
        {
          id: 'mirror.device',
          node: (
            <ActionRow
              label={t('mirror.settings.device')}
              description={deviceDescription}
              action={
                <Button
                  variant="secondary"
                  isDisabled={mirror.deviceId === null}
                  onPress={() => {
                    write((current) => ({ ...current, deviceId: null, deviceLabel: null }));
                  }}
                >
                  {t('mirror.settings.useDefault')}
                </Button>
              }
            />
          ),
        },
      ]}
    />
  );
}
