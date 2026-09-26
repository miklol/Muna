import {
  DASHBOARD_GRID,
  DEFAULT_DASHBOARD_SLOTS,
  readDashboardSettings,
  writeDashboardSettings,
} from '@muna/contracts';
import { Button } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { totalSpan } from './layout';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → Dashboard (docs/modules/dashboard.md): how full the grid is and a way back to
 * the default layout. Arranging happens on the grid itself, in the panel's edit mode, because
 * that is where the widgets can be seen; this pane only reports and resets.
 */
export function DashboardSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const dashboard = readDashboardSettings(settings);
  const cells = totalSpan(dashboard.slots);

  return (
    <Section
      title={t('dashboard.settings.layout')}
      description={t('dashboard.settings.layoutBody')}
      visible={everything}
      rows={[
        {
          id: 'dashboard.widgets',
          node: (
            <ValueRow
              label={t('dashboard.settings.widgets')}
              description={t('dashboard.settings.cells', {
                used: cells,
                total: DASHBOARD_GRID.cells,
              })}
              value={t('dashboard.settings.count', { count: dashboard.slots.length })}
            />
          ),
        },
        {
          id: 'dashboard.reset',
          node: (
            <ActionRow
              label={t('dashboard.settings.reset')}
              description={t('dashboard.settings.resetBody')}
              action={
                <Button
                  variant="secondary"
                  onPress={() => {
                    update((current) =>
                      writeDashboardSettings(current, { slots: [...DEFAULT_DASHBOARD_SLOTS] }),
                    );
                  }}
                >
                  {t('dashboard.settings.resetAction')}
                </Button>
              }
            />
          ),
        },
      ]}
    />
  );
}
