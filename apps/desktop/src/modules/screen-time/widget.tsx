import { SegmentedRing, Text } from '@muna/ui';
import { Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { categorySegments, formatDuration } from './format';
import { useScreenTimeStore } from './screen-time-store';
import { useScreenTimeSubscription } from './use-screen-time';
import './screen-time.css';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
/** The small donut on the card. */
export const WIDGET_RING_DIAMETER = 40;
/** How many apps the wide card lists. */
const WIDE_APPS = 3;

/**
 * The screen time card on the dashboard (docs/modules/screen-time.md "Widget"): a small donut
 * of today's categories beside the total and the app in front. A wide card adds the leading
 * apps. Off, or with nothing counted yet, it says so in one line.
 */
export function ScreenTimeWidget({ span }: WidgetProps) {
  const { t } = useTranslation();
  useScreenTimeSubscription();
  const snapshot = useScreenTimeStore((store) => store.snapshot);

  if (snapshot === null) return null;

  const off = snapshot.tracking === 'off';
  if (off || (snapshot.today.totalMs === 0 && snapshot.now === null)) {
    return (
      <div className="stime-widget" data-empty data-off={off || undefined}>
        <span className="stime-widget__glyph">
          <Hourglass strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        </span>
        <Text as="p" variant="footnote" tone="secondary">
          {off ? t('screenTime.widget.off') : t('screenTime.widget.empty')}
        </Text>
      </div>
    );
  }

  const total = formatDuration(snapshot.today.totalMs, t);
  let nowLine: string;
  switch (snapshot.tracking) {
    case 'idle':
      nowLine = t('screenTime.now.idle');
      break;
    case 'locked':
      nowLine = t('screenTime.now.locked');
      break;
    default:
      nowLine = snapshot.now?.name ?? t('screenTime.now.nothing');
  }
  const shown = snapshot.categories.filter((entry) => entry.totalMs > 0).length;

  return (
    <div className="stime-widget" aria-label={t('screenTime.widget.label')}>
      <SegmentedRing
        diameter={WIDGET_RING_DIAMETER}
        size="small"
        segments={categorySegments(snapshot.categories)}
        aria-label={t('screenTime.donut.describe', { duration: total, count: shown })}
      />
      <div className="stime-widget__text">
        <Text as="p" variant="callout" tabular truncate={1}>
          {total}
        </Text>
        <Text as="p" variant="caption" tone="secondary" truncate={1} className="stime-widget__now">
          {nowLine}
        </Text>
      </div>
      {span === 2 && snapshot.apps.length > 0 && (
        <ul className="stime-widget__apps" aria-label={t('screenTime.apps.label')}>
          {snapshot.apps.slice(0, WIDE_APPS).map((app) => (
            <li key={app.exe} className="stime-widget__app">
              <Text as="span" variant="caption" tone="secondary" truncate={1}>
                {app.name}
              </Text>
              <Text as="span" variant="caption" tone="tertiary" tabular>
                {formatDuration(app.totalMs, t)}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
