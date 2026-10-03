import {
  readSystemMonitorSettings,
  SYSTEM_MONITOR_BOUNDS,
  type SystemMonitorSettings,
  writeSystemMonitorSettings,
} from '@muna/contracts';
import { useTranslation } from 'react-i18next';

import { Section, SliderRow, ToggleRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → System (docs/modules/system-monitor.md): whether a CPU gauge sits in the
 * collapsed strip, and how many processes the panel lists. Writes go through the shared editor
 * so they save like any other setting and reach Rust, which changes its sampling cadence at
 * once. Slider drags are debounced; the release saves.
 */
export function SystemMonitorSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const monitor = readSystemMonitorSettings(settings);

  const write = (
    recipe: (current: SystemMonitorSettings) => SystemMonitorSettings,
    debounced = false,
  ) => {
    update(
      (current) => writeSystemMonitorSettings(current, recipe(readSystemMonitorSettings(current))),
      { debounced },
    );
  };
  const rows = (value: number) => t('systemMonitor.settings.processRows', { count: value });

  return (
    <>
      <Section
        title={t('systemMonitor.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'systemMonitor.showCpuInStrip',
            node: (
              <ToggleRow
                label={t('systemMonitor.settings.showCpuInStrip')}
                description={t('systemMonitor.settings.showCpuInStripBody')}
                isSelected={monitor.showCpuInStrip}
                onChange={(showCpuInStrip) => {
                  write((current) => ({ ...current, showCpuInStrip }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('systemMonitor.settings.panel')}
        visible={everything}
        rows={[
          {
            id: 'systemMonitor.processCount',
            node: (
              <SliderRow
                label={t('systemMonitor.settings.processCount')}
                description={t('systemMonitor.settings.processCountBody')}
                value={monitor.processCount}
                minValue={SYSTEM_MONITOR_BOUNDS.processCount.min}
                maxValue={SYSTEM_MONITOR_BOUNDS.processCount.max}
                format={rows}
                onChange={(processCount) => {
                  write((current) => ({ ...current, processCount }), true);
                }}
                onChangeEnd={(processCount) => {
                  write((current) => ({ ...current, processCount }));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}
