import type { Task } from '@muna/contracts';
import { Text } from '@muna/ui';
import { Circle, ListChecks } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useLocale } from '../../lib/locale';
import type { WidgetProps } from '../registry';
import { describeDue, type DueWords, isOverdue } from './due-label';
import './todo.css';
import { useTodoStore } from './todo-store';
import { useTodoSubscription } from './use-todo';

/** Lucide icons in the card body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;
const ROW_ICON = 14;

/** Rows a card shows before it says how many more there are. */
export const WIDGET_ROWS = 3;

/**
 * Open tasks across every list, the soonest due first, then undated ones in their stored order
 * — what the card lists (docs/modules/dashboard.md "Widgets": Reminders/Tasks).
 */
export const upcomingTasks = (tasks: readonly Task[]): Task[] => {
  const open = tasks.filter((task) => task.deletedAtMs === null && task.completedAtMs === null);
  return open.sort((a, b) => {
    if (a.dueMs === null && b.dueMs === null) return a.sortOrder - b.sortOrder;
    if (a.dueMs === null) return 1;
    if (b.dueMs === null) return -1;
    return a.dueMs - b.dueMs;
  });
};

/**
 * The tasks card on the dashboard: up to three open tasks, the soonest due first, with the due
 * date on the right (red once overdue) and a last line counting the rest. Nothing here can
 * complete or edit — the card is a glance, the panel is where tasks are worked.
 */
export function TodoWidget(_props: WidgetProps) {
  const { t } = useTranslation();
  useTodoSubscription();
  const snapshot = useTodoStore((store) => store.snapshot);
  const now = useTodoStore((store) => store.receivedAt);
  const locale = useLocale();
  const words = useMemo<DueWords>(
    () => ({
      today: t('todo.due.today'),
      tomorrow: t('todo.due.tomorrow'),
      yesterday: t('todo.due.yesterday'),
      dayAt: (day, time) => t('todo.due.dayAt', { day, time }),
    }),
    [t],
  );

  if (snapshot === null) return null;

  const open = upcomingTasks(snapshot.tasks);
  if (open.length === 0) {
    return (
      <div className="todo-widget" data-empty>
        <ListChecks size={20} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
        <Text as="p" variant="footnote" tone="secondary" className="todo-widget__empty">
          {t('todo.widget.empty')}
        </Text>
      </div>
    );
  }

  const shown = open.slice(0, WIDGET_ROWS);
  const rest = open.length - shown.length;
  return (
    <div className="todo-widget">
      <ul className="todo-widget__list" aria-label={t('todo.title')}>
        {shown.map((task) => {
          const due = task.dueMs === null ? null : { atMs: task.dueMs, allDay: task.allDay };
          const overdue = due !== null && isOverdue(due, now);
          return (
            <li key={task.id} className="todo-widget__row" data-overdue={overdue || undefined}>
              <Circle size={ROW_ICON} strokeWidth={ICON_STROKE} aria-hidden focusable={false} />
              <Text as="span" variant="footnote" truncate={1} className="todo-widget__title">
                {task.title}
              </Text>
              {due !== null && (
                <Text
                  as="span"
                  variant="caption"
                  tone="secondary"
                  tabular
                  className="todo-widget__due"
                >
                  {describeDue(due, now, locale, words)}
                  {overdue && <span className="sr-only">{t('todo.due.overdueSuffix')}</span>}
                </Text>
              )}
            </li>
          );
        })}
      </ul>
      {rest > 0 && (
        <Text as="p" variant="caption" tone="tertiary" className="todo-widget__more">
          {t('todo.widget.more', { count: rest })}
        </Text>
      )}
    </div>
  );
}
