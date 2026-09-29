import { type Task, type TaskDue, TODO_INBOX_LIST_ID } from '@muna/contracts';
import {
  Button,
  Checkbox,
  Chip,
  contentExitTransition,
  contentRecipe,
  EmptyState,
  IconButton,
  SegmentedControl,
  type SegmentedControlItem,
  Text,
  TextField,
  useMotionPreset,
  useReduceMotion,
} from '@muna/ui';
import { CalendarClock, ListChecks, Plus, Trash2, Undo2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { describeDue, type DueWords, isOverdue } from './due-label';
import { parseTask } from './parse-task';
import './todo.css';
import { listTasks, orderedLists, trashedTasks, useTodoStore } from './todo-store';
import { useTodoCommand, useTodoSubscription } from './use-todo';

/** Lucide icons in the panel body use stroke 1.75 (docs/05-design-system.md). */
const ICON_STROKE = 1.75;

type View = 'list' | 'trash';

interface DueLabelProps {
  due: TaskDue;
  now: number;
  locale: string;
  words: DueWords;
  overdueSuffix: string;
}

/** The due date on a row, `--accent-red` once it has passed (with the word for readers). */
function DueLabel({ due, now, locale, words, overdueSuffix }: DueLabelProps) {
  const overdue = isOverdue(due, now);
  return (
    <Text
      as="span"
      variant="footnote"
      tone="secondary"
      tabular
      className="todo-row__due"
      data-overdue={overdue || undefined}
    >
      {describeDue(due, now, locale, words)}
      {overdue && <span className="sr-only">{overdueSuffix}</span>}
    </Text>
  );
}

const taskDue = (task: Task): TaskDue | null =>
  task.dueMs === null ? null : { atMs: task.dueMs, allDay: task.allDay };

/**
 * The to-do panel (docs/modules/todo.md): a quick-add field that reads dates in words, the
 * lists as segments when there is more than one, and the tasks — a spring check to complete,
 * the due date on the right (red once overdue), move to trash on hover. The trash view lists
 * deleted tasks with restore and says how long they stay. Rows slide with the `layout` spring
 * when one is added, completed or removed; the panel keeps no timers.
 */
export function TodoPanel() {
  const { t, i18n } = useTranslation();
  useTodoSubscription();
  const snapshot = useTodoStore((store) => store.snapshot);
  const now = useTodoStore((store) => store.receivedAt);
  const send = useTodoCommand();
  const reduceMotion = useReduceMotion();
  const layoutSpring = useMotionPreset('layout');
  const enterSpring = useMotionPreset('content');
  const [chosenListId, setChosenListId] = useState<string>(TODO_INBOX_LIST_ID);
  const [view, setView] = useState<View>('list');
  const [draft, setDraft] = useState('');

  const locale = i18n.resolvedLanguage ?? i18n.language;
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

  const lists = orderedLists(snapshot.lists);
  // The chosen list may have been deleted from Settings meanwhile; the default list always exists.
  const listId = lists.some((list) => list.id === chosenListId) ? chosenListId : TODO_INBOX_LIST_ID;
  const trash = view === 'trash';
  const tasks = trash ? trashedTasks(snapshot.tasks) : listTasks(snapshot.tasks, listId);
  const completed = tasks.filter((task) => task.completedAtMs !== null);
  const preview = draft.trim() === '' ? null : parseTask(draft, new Date(now)).due;
  const overdueSuffix = t('todo.due.overdueSuffix');
  const segments: SegmentedControlItem[] = lists.map((list) => ({
    id: list.id,
    label: list.name ?? t('todo.inbox'),
  }));

  const add = (value: string) => {
    const parsed = parseTask(value, new Date());
    send({ kind: 'add', listId, title: parsed.title, due: parsed.due });
    setDraft('');
  };

  const enterFrom = reduceMotion ? contentRecipe.reducedEnterFrom : contentRecipe.enterFromLarge;
  const visible = reduceMotion ? contentRecipe.reducedVisible : contentRecipe.visible;
  const exitTo = {
    ...(reduceMotion ? contentRecipe.reducedExitTo : contentRecipe.exitTo),
    transition: contentExitTransition,
  };

  return (
    <div className="todo-panel" data-view={view} data-lists={lists.length > 1 || undefined}>
      <div className="todo-toolbar">
        {trash ? (
          <div className="todo-trash-heading">
            <Text as="h3" variant="body" weight={600} className="todo-trash-heading__title">
              {t('todo.trash')}
            </Text>
            <Text as="p" variant="footnote" tone="secondary" className="todo-trash-heading__note">
              {t('todo.retention', { count: snapshot.retentionDays })}
            </Text>
          </div>
        ) : (
          <>
            <TextField
              aria-label={t('todo.add')}
              placeholder={t('todo.add')}
              className="todo-add"
              leading={<Plus size={16} strokeWidth={ICON_STROKE} />}
              value={draft}
              onChange={setDraft}
              onSubmit={add}
            />
            <span className="todo-add__preview" aria-live="polite">
              {preview !== null && (
                <Chip icon={<CalendarClock size={12} strokeWidth={ICON_STROKE} />}>
                  {t('todo.dueIn', { due: describeDue(preview, now, locale, words) })}
                </Chip>
              )}
            </span>
          </>
        )}
        <div className="todo-toolbar__actions">
          {trash
            ? tasks.length > 0 && (
                <Button
                  variant="secondary"
                  onPress={() => {
                    send({ kind: 'emptyTrash' });
                  }}
                >
                  {t('todo.emptyTrash')}
                </Button>
              )
            : completed.length > 0 && (
                <Button
                  variant="secondary"
                  onPress={() => {
                    for (const task of completed) send({ kind: 'delete', id: task.id });
                  }}
                >
                  {t('todo.clearCompleted')}
                </Button>
              )}
          <IconButton
            aria-label={t('todo.trash')}
            aria-pressed={trash}
            isActive={trash}
            onPress={() => {
              setView(trash ? 'list' : 'trash');
            }}
          >
            <Trash2 strokeWidth={ICON_STROKE} />
          </IconButton>
        </div>
      </div>
      {!trash && lists.length > 1 && (
        <SegmentedControl
          aria-label={t('todo.lists')}
          className="todo-lists"
          items={segments}
          value={listId}
          onChange={setChosenListId}
        />
      )}
      {tasks.length === 0 ? (
        <EmptyState
          className="todo-empty"
          icon={<ListChecks size={24} strokeWidth={1.5} />}
          title={trash ? t('todo.trashEmpty') : t('todo.empty')}
          description={
            trash
              ? t('todo.trashEmptyBody', { count: snapshot.retentionDays })
              : t('todo.emptyBody')
          }
        />
      ) : (
        <ul className="todo-list" aria-label={trash ? t('todo.trash') : t('todo.title')}>
          <AnimatePresence mode="popLayout" initial={false}>
            {tasks.map((task) => {
              const due = taskDue(task);
              const done = task.completedAtMs !== null;
              return (
                <motion.li
                  key={task.id}
                  layout={!reduceMotion}
                  initial={enterFrom}
                  animate={visible}
                  exit={exitTo}
                  transition={{ ...enterSpring, layout: layoutSpring }}
                  className="todo-row"
                  data-done={done || undefined}
                >
                  {trash ? (
                    <Text
                      as="span"
                      variant="body"
                      tone="secondary"
                      truncate={1}
                      className="todo-row__title"
                    >
                      {task.title}
                    </Text>
                  ) : (
                    <Checkbox
                      className="todo-row__check"
                      isSelected={done}
                      onChange={(completed) => {
                        send({ kind: 'complete', id: task.id, completed });
                      }}
                    >
                      <Text as="span" variant="body" truncate={1} className="todo-row__title">
                        {task.title}
                      </Text>
                    </Checkbox>
                  )}
                  {due !== null && (
                    <DueLabel
                      due={due}
                      now={now}
                      locale={locale}
                      words={words}
                      overdueSuffix={overdueSuffix}
                    />
                  )}
                  {trash ? (
                    <IconButton
                      aria-label={t('todo.restore', { title: task.title })}
                      className="todo-row__action"
                      onPress={() => {
                        send({ kind: 'restore', id: task.id });
                      }}
                    >
                      <Undo2 strokeWidth={ICON_STROKE} />
                    </IconButton>
                  ) : (
                    <IconButton
                      aria-label={t('todo.moveToTrash', { title: task.title })}
                      className="todo-row__action todo-row__action--reveal"
                      onPress={() => {
                        send({ kind: 'delete', id: task.id });
                      }}
                    >
                      <Trash2 strokeWidth={ICON_STROKE} />
                    </IconButton>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
