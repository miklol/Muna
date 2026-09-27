import { formatCountdown, IconButton, Ring, Text } from '@muna/ui';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { WidgetProps } from '../registry';
import { flowTitleKey, formatDuration, mindfulMinutes } from './format';
import { useHealthStore } from './health-store';
import './health.css';
import { useHealthClock } from './use-health-clock';
import { useHealthCommand, useHealthSubscription } from './use-health';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

/** The card's rings: three 6 px strokes with 2 px between them fit a 56 px dial. */
export const WIDGET_RING_DIAMETERS = [56, 40, 24] as const;

/**
 * The health card on the dashboard (docs/modules/dashboard.md "Widgets"): the three goal
 * rings small, how long the sit has been and when the next reminder comes (or why the timer
 * is paused), and a button that logs a glass of water. The sitting time counts up once a
 * minute's worth of seconds only while sitting and mounted, exactly like the panel.
 */
export function HealthWidget(_props: WidgetProps) {
  const { t } = useTranslation();
  useHealthSubscription();
  const snapshot = useHealthStore((store) => store.snapshot);
  const receivedAt = useHealthStore((store) => store.receivedAt);
  const clock = useHealthClock(snapshot, receivedAt);
  const send = useHealthCommand();

  if (snapshot === null) return null;

  const { today, goals } = snapshot;
  const mindful = mindfulMinutes(today.mindfulSeconds);
  const mindfulGoal = Math.max(1, mindfulMinutes(goals.mindfulSeconds));
  let title: string;
  let status: string;
  if (snapshot.flow !== null) {
    title = t('health.widget.flow', { flow: t(flowTitleKey[snapshot.flow.flow]) });
    status =
      clock.flowRemainingMs === null
        ? ''
        : t('health.flow.remaining', { remaining: formatCountdown(clock.flowRemainingMs) });
  } else {
    switch (snapshot.sitting) {
      case 'sitting':
        title = t('health.widget.sitting', { duration: formatDuration(clock.sittingMs, t) });
        status =
          snapshot.breakDueSinceMs !== null
            ? t('health.widget.breakDue')
            : clock.nextBreakInMs === null
              ? t('health.widget.water', { count: today.water, goal: goals.water })
              : t('health.widget.nextBreak', {
                  duration: formatDuration(clock.nextBreakInMs, t),
                });
        break;
      case 'away':
        title = t('health.widget.away');
        status = t('health.widget.water', { count: today.water, goal: goals.water });
        break;
      case 'locked':
        title = t('health.widget.locked');
        status = t('health.widget.water', { count: today.water, goal: goals.water });
        break;
      case 'off':
        title = t('health.widget.off');
        status = t('health.state.offBody');
        break;
    }
  }
  const rings = [
    {
      id: 'breaks',
      tint: 'green',
      label: t('health.rings.breaks'),
      value: Math.min(today.breaks, goals.breaks),
      goal: goals.breaks,
      text: t('health.rings.breaksValue', { count: today.breaks, goal: goals.breaks }),
    },
    {
      id: 'water',
      tint: 'blue',
      label: t('health.rings.water'),
      value: Math.min(today.water, goals.water),
      goal: goals.water,
      text: t('health.rings.waterValue', { count: today.water, goal: goals.water }),
    },
    {
      id: 'mindful',
      tint: 'purple',
      label: t('health.rings.mindful'),
      value: Math.min(mindful, mindfulGoal),
      goal: mindfulGoal,
      text: t('health.rings.mindfulValue', { count: mindful, goal: mindfulGoal }),
    },
  ] as const;

  return (
    <div className="health-widget" data-sitting={snapshot.sitting}>
      <div className="health-widget__rings">
        {rings.map((ring, index) => (
          <Ring
            key={ring.id}
            className="health-widget__ring"
            diameter={WIDGET_RING_DIAMETERS[index] ?? WIDGET_RING_DIAMETERS[2]}
            size="small"
            tint={ring.tint}
            aria-label={ring.label}
            value={ring.value}
            minValue={0}
            maxValue={ring.goal}
            valueText={ring.text}
          />
        ))}
      </div>
      <div className="health-widget__text">
        <Text as="span" variant="footnote" weight={600} truncate={1}>
          {title}
        </Text>
        <Text as="span" variant="caption" tone="secondary" truncate={1}>
          {status}
        </Text>
      </div>
      <IconButton
        aria-label={t('health.rings.addWater')}
        className="health-widget__water"
        isDisabled={snapshot.sitting === 'off'}
        onPress={() => {
          void send({ kind: 'water', delta: 1 });
        }}
      >
        <Plus strokeWidth={ICON_STROKE} />
      </IconButton>
    </div>
  );
}
