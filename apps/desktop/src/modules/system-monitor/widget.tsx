import { Ring, Text } from '@muna/ui';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { buildGauges } from './panel';
import { useSystemMonitorStore } from './system-monitor-store';
import './system-monitor.css';
import { useSystemMonitorSubscription } from './use-system-monitor';

/** The card's rings: 32 px so two fit a narrow card with their numbers. */
export const WIDGET_RING_DIAMETER = 32;

/** A narrow card shows CPU and memory; a wide one adds storage and network. */
export const WIDGET_GAUGES = { 1: 2, 2: 4 } as const;

/**
 * The system card on the dashboard (docs/modules/dashboard.md "Widgets": System stats mini):
 * the first gauges of the panel — CPU, memory, then storage and network on a wide card — as
 * small rings with the value beside them. Mounting starts the 1 Hz sampling in Rust and
 * unmounting stops it, exactly like the panel.
 */
export function SystemMonitorWidget({ span }: WidgetProps) {
  const { t, i18n } = useTranslation();
  useSystemMonitorSubscription();
  const snapshot = useSystemMonitorStore((store) => store.snapshot);
  const peak = useSystemMonitorStore((store) => store.peakNetworkBytesPerS);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const gauges = buildGauges(snapshot, peak, { t, locale }).slice(0, WIDGET_GAUGES[span]);

  return (
    <ul className="sysmon-widget" aria-label={t('systemMonitor.title')}>
      {gauges.map((gauge) => (
        <li key={gauge.id} className="sysmon-widget__gauge" data-gauge={gauge.id}>
          <Ring
            diameter={WIDGET_RING_DIAMETER}
            size="small"
            tint={gauge.tint}
            value={gauge.fraction ?? 0}
            aria-label={gauge.label}
            valueText={t('systemMonitor.gaugeValue', {
              label: gauge.label,
              value: gauge.fraction === null ? gauge.detail : `${gauge.value}, ${gauge.detail}`,
            })}
          />
          <div className="sysmon-widget__text">
            <Text as="span" variant="caption" tone="secondary" truncate={1}>
              {gauge.label}
            </Text>
            <Text as="span" variant="footnote" weight={600} tabular truncate={1}>
              {gauge.value}
            </Text>
          </div>
        </li>
      ))}
    </ul>
  );
}
