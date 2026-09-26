import type { SystemMonitorSnapshot } from '@muna/contracts';
import type { Translate } from '@muna/i18n';
import { Ring, Text, type Tint } from '@muna/ui';
import {
  ArrowUpDown,
  Battery,
  BatteryCharging,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatBytes, formatPercent, formatRate, formatTenths, share } from './format';
import {
  NETWORK_RING_FLOOR_BYTES_PER_S,
  networkTotal,
  useSystemMonitorStore,
} from './system-monitor-store';
import './system-monitor.css';
import { useSystemMonitorSubscription } from './use-system-monitor';

/** Ring diameter from the reference (docs/reference/ui-observations.md "System Analytics"). */
export const GAUGE_RING_DIAMETER = 36;
/** Tile label glyphs: 14 px at stroke 1.75, inline with the 12 px label. */
const LABEL_ICON = { size: 14, strokeWidth: 1.75, 'aria-hidden': true, focusable: false } as const;

type GaugeId = 'cpu' | 'memory' | 'storage' | 'network' | 'battery' | 'freeDisk';

interface Gauge {
  id: GaugeId;
  label: string;
  icon: ReactNode;
  tint: Tint;
  /** 0–100 for the ring; `null` leaves the ring empty (no reading yet, or nothing to measure). */
  fraction: number | null;
  /** The big number. */
  value: string;
  /** The line under it. */
  detail: string;
}

interface Formatters {
  t: Translate;
  locale: string;
}

/** The six tiles in reading order, from a snapshot (or none: every tile waits). */
export function buildGauges(
  snapshot: SystemMonitorSnapshot | null,
  peakNetworkBytesPerS: number,
  { t, locale }: Formatters,
): Gauge[] {
  const pending = t('systemMonitor.pending');
  const waiting = t('systemMonitor.waiting');
  const bytes = (value: number) => formatBytes(value, locale);
  const ofTotal = (total: number) => t('systemMonitor.ofTotal', { total: bytes(total) });

  const cpu: Gauge = {
    id: 'cpu',
    label: t('systemMonitor.cpu'),
    icon: <Cpu {...LABEL_ICON} />,
    tint: 'blue',
    fraction: snapshot?.cpuPercent ?? null,
    value:
      snapshot?.cpuPercent === null || snapshot === null
        ? pending
        : formatPercent(snapshot.cpuPercent, locale),
    detail: snapshot === null ? waiting : t('systemMonitor.cores', { count: snapshot.logicalCpus }),
  };
  const memory: Gauge = {
    id: 'memory',
    label: t('systemMonitor.memory'),
    icon: <MemoryStick {...LABEL_ICON} />,
    tint: 'green',
    fraction: snapshot === null ? null : share(snapshot.memoryUsedBytes, snapshot.memoryTotalBytes),
    value: snapshot === null ? pending : bytes(snapshot.memoryUsedBytes),
    detail: snapshot === null ? waiting : ofTotal(snapshot.memoryTotalBytes),
  };
  const storage: Gauge = {
    id: 'storage',
    label: t('systemMonitor.storage'),
    icon: <HardDrive {...LABEL_ICON} />,
    tint: 'cyan',
    fraction:
      snapshot === null ? null : share(snapshot.storageUsedBytes, snapshot.storageTotalBytes),
    value: snapshot === null ? pending : bytes(snapshot.storageUsedBytes),
    detail: snapshot === null ? waiting : ofTotal(snapshot.storageTotalBytes),
  };
  const total = snapshot === null ? null : networkTotal(snapshot);
  const network: Gauge = {
    id: 'network',
    label: t('systemMonitor.network'),
    icon: <ArrowUpDown {...LABEL_ICON} />,
    tint: 'blue',
    fraction:
      total === null
        ? null
        : share(total, Math.max(peakNetworkBytesPerS, NETWORK_RING_FLOOR_BYTES_PER_S)),
    value: total === null ? pending : formatRate(total, locale),
    detail:
      snapshot === null
        ? waiting
        : snapshot.networkDownBytesPerS === null || snapshot.networkUpBytesPerS === null
          ? pending
          : t('systemMonitor.networkDetail', {
              down: formatRate(snapshot.networkDownBytesPerS, locale),
              up: formatRate(snapshot.networkUpBytesPerS, locale),
            }),
  };
  const charge = snapshot?.battery ?? null;
  const battery: Gauge = {
    id: 'battery',
    label: t('systemMonitor.battery'),
    icon: charge?.charging ? <BatteryCharging {...LABEL_ICON} /> : <Battery {...LABEL_ICON} />,
    tint:
      charge === null
        ? 'green'
        : charge.percent <= 10
          ? 'red'
          : charge.percent <= 20
            ? 'orange'
            : 'green',
    fraction: charge?.percent ?? null,
    value: charge === null ? pending : formatPercent(charge.percent, locale),
    detail:
      snapshot === null
        ? waiting
        : charge === null
          ? t('systemMonitor.noBattery')
          : t(charge.charging ? 'systemMonitor.charging' : 'systemMonitor.notCharging'),
  };
  const freeDisk: Gauge = {
    id: 'freeDisk',
    label: t('systemMonitor.freeDisk'),
    icon: <Database {...LABEL_ICON} />,
    tint: 'cyan',
    fraction:
      snapshot === null ? null : share(snapshot.freeDiskBytes, snapshot.systemDiskTotalBytes),
    value: snapshot === null ? pending : bytes(snapshot.freeDiskBytes),
    detail: snapshot === null ? waiting : ofTotal(snapshot.systemDiskTotalBytes),
  };
  return [cpu, memory, storage, network, battery, freeDisk];
}

interface GaugeTileProps {
  gauge: Gauge;
  valueText: string;
}

/** One tile: the ring on the left; label with glyph, big value and detail stacked beside it. */
function GaugeTile({ gauge, valueText }: GaugeTileProps) {
  return (
    <li className="sysmon-tile" data-gauge={gauge.id}>
      <Ring
        className="sysmon-tile__ring"
        diameter={GAUGE_RING_DIAMETER}
        size="small"
        tint={gauge.tint}
        value={gauge.fraction ?? 0}
        aria-label={gauge.label}
        valueText={valueText}
      />
      <div className="sysmon-tile__text">
        <Text as="span" variant="footnote" tone="secondary" className="sysmon-tile__label">
          {gauge.icon}
          {gauge.label}
        </Text>
        <Text as="span" variant="title3" tabular className="sysmon-tile__value">
          {gauge.value}
        </Text>
        <Text as="span" variant="footnote" tone="tertiary" tabular className="sysmon-tile__detail">
          {gauge.detail}
        </Text>
      </div>
    </li>
  );
}

interface ProcessTableProps {
  processes: SystemMonitorSnapshot['processes'];
  locale: string;
}

/** The busiest processes, most CPU first; a real table so the columns read as columns. */
function ProcessTable({ processes, locale }: ProcessTableProps) {
  const { t } = useTranslation();
  return (
    <table className="sysmon-processes">
      <caption className="sysmon-processes__caption">{t('systemMonitor.processes')}</caption>
      <thead>
        <tr>
          <th scope="col" className="sysmon-processes__name">
            <Text as="span" variant="caption" tone="tertiary">
              {t('systemMonitor.processName')}
            </Text>
          </th>
          <th scope="col" className="sysmon-processes__number">
            <Text as="span" variant="caption" tone="tertiary">
              {t('systemMonitor.processCpu')}
            </Text>
          </th>
          <th scope="col" className="sysmon-processes__number">
            <Text as="span" variant="caption" tone="tertiary">
              {t('systemMonitor.processMemory')}
            </Text>
          </th>
        </tr>
      </thead>
      <tbody>
        {processes.map((process) => (
          <tr key={process.name}>
            <td className="sysmon-processes__name">
              <span className="sysmon-processes__cell">
                <Text as="span" variant="footnote" className="sysmon-processes__title">
                  {process.name}
                </Text>
                {process.count > 1 && (
                  <Text
                    as="span"
                    variant="caption"
                    tone="tertiary"
                    tabular
                    className="sysmon-processes__count"
                    aria-label={t('systemMonitor.instances', { count: process.count })}
                  >
                    {t('systemMonitor.instancesShort', { count: process.count })}
                  </Text>
                )}
              </span>
            </td>
            <td className="sysmon-processes__number">
              <Text as="span" variant="footnote" tabular>
                {formatTenths(process.cpuTenths, locale)}
              </Text>
            </td>
            <td className="sysmon-processes__number">
              <Text as="span" variant="footnote" tabular>
                {formatBytes(process.memoryBytes, locale)}
              </Text>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The system monitor panel (docs/modules/system-monitor.md, docs/reference/ui-observations.md
 * "System Analytics"): a 3×2 grid of ring gauges — CPU, memory, storage, network, battery,
 * free disk — and, beside it, the busiest processes. Mounting starts the 1 Hz sampling in
 * Rust and unmounting stops it; the panel itself holds no timers. Rings follow each reading
 * with the `interactive` preset, so a value moves rather than jumps.
 */
export function SystemMonitorPanel() {
  const { t, i18n } = useTranslation();
  useSystemMonitorSubscription();
  const snapshot = useSystemMonitorStore((store) => store.snapshot);
  const peak = useSystemMonitorStore((store) => store.peakNetworkBytesPerS);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const gauges = buildGauges(snapshot, peak, { t, locale });
  const processes = snapshot?.processes ?? [];

  return (
    <div className="sysmon-panel" data-processes={processes.length > 0 || undefined}>
      <ul className="sysmon-grid" aria-label={t('systemMonitor.title')}>
        {gauges.map((gauge) => (
          <GaugeTile
            key={gauge.id}
            gauge={gauge}
            valueText={t('systemMonitor.gaugeValue', {
              label: gauge.label,
              value: gauge.fraction === null ? gauge.detail : `${gauge.value}, ${gauge.detail}`,
            })}
          />
        ))}
      </ul>
      {processes.length > 0 && <ProcessTable processes={processes} locale={locale} />}
    </div>
  );
}
