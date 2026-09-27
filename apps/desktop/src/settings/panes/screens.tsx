import type { MonitorInfo, MonitorLayout } from '@muna/contracts';
import { commands } from '@muna/contracts';
import { Card, Chip, EmptyState, ErrorState, Hairline, Skeleton, Text } from '@muna/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { unwrap } from '../../lib/ipc';
import { useLocale } from '../../lib/locale';
import { type RowFilter, ToggleRow } from '../rows';
import { useSettingsEditor } from '../settings-editor';
import {
  EnabledRow,
  type LayoutPatch,
  ModeRow,
  OffsetXRow,
  OffsetYRow,
  ShapeRow,
  StripHeightRow,
} from './layout-rows';

export const monitorsQuery = {
  queryKey: ['monitors'] as const,
  queryFn: async () => unwrap(await commands.listMonitors()),
};

interface PaneProps {
  visible: RowFilter;
}

/** `\\.\DISPLAY2` → 2; anything else falls back to its position in the list. */
export const displayNumber = (id: string, index: number): number => {
  const match = /(\d+)\s*$/.exec(id);
  return match?.[1] === undefined ? index + 1 : Number(match[1]);
};

interface ScreenCardProps {
  monitor: MonitorInfo;
  number: number;
}

function ScreenCard({ monitor, number }: ScreenCardProps) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { settings, update } = useSettingsEditor();
  const own: MonitorLayout | undefined = settings.shell.monitors[monitor.id];
  const layout = own ?? settings.shell.defaults;

  const patch: LayoutPatch = (fields, options) => {
    update(
      (current) => ({
        ...current,
        shell: {
          ...current.shell,
          monitors: {
            ...current.shell.monitors,
            [monitor.id]: {
              ...(current.shell.monitors[monitor.id] ?? current.shell.defaults),
              ...fields,
            },
          },
        },
      }),
      options,
    );
  };

  const setUsesDefaults = (usesDefaults: boolean) => {
    update((current) => {
      // Dropping the entry is the reset: the screen follows the defaults again.
      const monitors = usesDefaults
        ? Object.fromEntries(
            Object.entries(current.shell.monitors).filter(([id]) => id !== monitor.id),
          )
        : { ...current.shell.monitors, [monitor.id]: { ...current.shell.defaults } };
      return { ...current, shell: { ...current.shell, monitors } };
    });
  };

  const scale = new Intl.NumberFormat(locale, { style: 'percent' }).format(monitor.dpi / 96);
  const geometry = t('settings.screens.geometry', {
    width: monitor.bounds.width,
    height: monitor.bounds.height,
    scale,
  });

  const rows = own
    ? [
        <EnabledRow key="enabled" layout={layout} onChange={patch} />,
        <ShapeRow key="shape" layout={layout} onChange={patch} />,
        <ModeRow key="mode" layout={layout} onChange={patch} />,
        <StripHeightRow key="stripHeight" layout={layout} onChange={patch} />,
        <OffsetXRow key="offsetX" layout={layout} onChange={patch} />,
        <OffsetYRow key="offsetY" layout={layout} onChange={patch} />,
      ]
    : [];

  return (
    <Card
      title={t('settings.screens.display', { number })}
      trailing={monitor.isPrimary ? <Chip>{t('settings.screens.primary')}</Chip> : undefined}
      data-testid={`screen-${monitor.id}`}
    >
      <Text as="p" variant="footnote" tone="secondary" tabular className="px-3">
        {geometry}
      </Text>
      <ToggleRow
        label={t('settings.screens.useDefaults')}
        description={t('settings.screens.useDefaultsBody')}
        isSelected={own === undefined}
        onChange={setUsesDefaults}
      />
      {rows.map((row) => (
        <Fragment key={row.key}>
          <Hairline />
          {row}
        </Fragment>
      ))}
    </Card>
  );
}

/** Multiple screens: one card per attached display, each following the defaults or its own layout. */
export function ScreensPane({ visible }: PaneProps) {
  const { t } = useTranslation();
  const monitors = useQuery(monitorsQuery);

  if (!visible('screens.monitors')) {
    return null;
  }
  return (
    <section aria-label={t('settings.pane.screens')} className="flex flex-col gap-2">
      <Text as="p" variant="footnote" tone="secondary" className="px-3">
        {t('settings.screens.body')}
      </Text>
      {monitors.isPending && <Skeleton shape="block" width="100%" height={96} />}
      {monitors.isError && (
        <ErrorState
          title={t('settings.screens.error')}
          retryLabel={t('settings.retry')}
          onRetry={() => {
            void monitors.refetch();
          }}
        />
      )}
      {monitors.isSuccess && monitors.data.length === 0 && (
        <EmptyState
          title={t('settings.screens.emptyTitle')}
          description={t('settings.screens.emptyBody')}
        />
      )}
      {monitors.isSuccess &&
        monitors.data.map((monitor, index) => (
          <ScreenCard
            key={monitor.id}
            monitor={monitor}
            number={displayNumber(monitor.id, index)}
          />
        ))}
    </section>
  );
}
