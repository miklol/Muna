import type { MonitorLayout } from '@muna/contracts';
import { Button } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, type RowFilter, Section } from '../rows';
import { useSettingsEditor } from '../settings-editor';
import {
  type LayoutPatch,
  ModeRow,
  OffsetXRow,
  OffsetYRow,
  ShapeRow,
  StripHeightRow,
} from './layout-rows';

interface PaneProps {
  visible: RowFilter;
}

/** Edits `shell.defaults`, the layout every screen without its own entry follows. */
const useDefaultsEditor = (): { defaults: MonitorLayout; patch: LayoutPatch } => {
  const { settings, update } = useSettingsEditor();
  return {
    defaults: settings.shell.defaults,
    patch: (patch, options) => {
      update(
        (current) => ({
          ...current,
          shell: { ...current.shell, defaults: { ...current.shell.defaults, ...patch } },
        }),
        options,
      );
    },
  };
};

/** Layout: shape, placement and strip height defaults. */
export function LayoutPane({ visible }: PaneProps) {
  const { t } = useTranslation();
  const { defaults, patch } = useDefaultsEditor();
  return (
    <Section
      title={t('settings.layout.defaults')}
      description={`${t('settings.layout.defaultsBody')} ${t('settings.layout.modeBody')}`}
      visible={visible}
      rows={[
        { id: 'layout.shape', node: <ShapeRow layout={defaults} onChange={patch} /> },
        { id: 'layout.mode', node: <ModeRow layout={defaults} onChange={patch} /> },
        { id: 'layout.stripHeight', node: <StripHeightRow layout={defaults} onChange={patch} /> },
      ]}
    />
  );
}

/** Notch position: the default offsets, applied live. */
export function PositionPane({ visible }: PaneProps) {
  const { t } = useTranslation();
  const { defaults, patch } = useDefaultsEditor();
  const centred = defaults.offsetX === 0 && defaults.offsetY === 0;
  return (
    <Section
      title={t('settings.position.offsets')}
      description={t('settings.position.offsetsBody')}
      visible={visible}
      rows={[
        { id: 'position.offsetX', node: <OffsetXRow layout={defaults} onChange={patch} /> },
        { id: 'position.offsetY', node: <OffsetYRow layout={defaults} onChange={patch} /> },
        {
          id: 'position.reset',
          node: (
            <ActionRow
              label={t('settings.position.reset')}
              action={
                <Button
                  isDisabled={centred}
                  onPress={() => {
                    patch({ offsetX: 0, offsetY: 0 });
                  }}
                >
                  {t('settings.position.reset')}
                </Button>
              }
            />
          ),
        },
      ]}
    />
  );
}
