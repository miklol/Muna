import {
  defaultTodoSettings,
  readTodoSettings,
  TODO_BOUNDS,
  TODO_INBOX_LIST_ID,
  type TodoSettings,
  writeTodoSettings,
} from '@muna/contracts';
import { IconButton, TextField } from '@muna/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ActionRow, Section, SliderRow, ToggleRow, ValueRow } from '../../settings/rows';
import { useSettingsEditor } from '../../settings/settings-editor';
import { orderedLists, useTodoStore } from './todo-store';
import { useTodoCommand, useTodoSubscription } from './use-todo';

/** Every module row survives search: module panes are not indexed yet (docs/modules/settings.md). */
const everything = () => true;

/**
 * Settings → Tasks (docs/modules/todo.md): how long the trash keeps a task, whether the next
 * due task shows in the strip and is announced, and the lists. Setting writes go through the
 * shared editor so they save like any other setting and reach Rust, which re-evaluates at once;
 * list changes are `TodoCommand`s, so they show in the panel the moment they land.
 */
export function TodoSettingsPane() {
  const { t } = useTranslation();
  const { settings, update } = useSettingsEditor();
  const todo = readTodoSettings(settings);
  useTodoSubscription();
  const snapshot = useTodoStore((store) => store.snapshot);
  const send = useTodoCommand();
  const [newList, setNewList] = useState('');

  const write = (recipe: (current: TodoSettings) => TodoSettings, debounced = false) => {
    update((current) => writeTodoSettings(current, recipe(readTodoSettings(current))), {
      debounced,
    });
  };
  const days = (value: number) => t('todo.settings.days', { count: value });
  const lists = orderedLists(snapshot?.lists ?? []);

  return (
    <>
      <Section
        title={t('todo.settings.trash')}
        visible={everything}
        rows={[
          {
            id: 'todo.retentionDays',
            node: (
              <SliderRow
                label={t('todo.settings.retentionDays')}
                description={t('todo.settings.retentionDaysBody')}
                value={todo.retentionDays}
                minValue={TODO_BOUNDS.retentionDays.min}
                maxValue={TODO_BOUNDS.retentionDays.max}
                format={days}
                onChange={(retentionDays) => {
                  write((current) => ({ ...current, retentionDays }), true);
                }}
                onChangeEnd={(retentionDays) => {
                  write((current) => ({ ...current, retentionDays }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('todo.settings.strip')}
        visible={everything}
        rows={[
          {
            id: 'todo.showDueInStrip',
            node: (
              <ToggleRow
                label={t('todo.settings.showDueInStrip')}
                description={t('todo.settings.showDueInStripBody')}
                isSelected={todo.showDueInStrip}
                onChange={(showDueInStrip) => {
                  write((current) => ({ ...current, showDueInStrip }));
                }}
              />
            ),
          },
          {
            id: 'todo.dueNotices',
            node: (
              <ToggleRow
                label={t('todo.settings.dueNotices')}
                description={t('todo.settings.dueNoticesBody')}
                isSelected={todo.dueNotices}
                onChange={(dueNotices) => {
                  write((current) => ({ ...current, dueNotices }));
                }}
              />
            ),
          },
        ]}
      />
      <Section
        title={t('todo.settings.lists')}
        description={t('todo.settings.listsBody')}
        visible={everything}
        rows={[
          ...lists.map((list) => {
            const name = list.name ?? t('todo.inbox');
            return {
              id: `todo.list.${list.id}`,
              node:
                list.id === TODO_INBOX_LIST_ID ? (
                  <ValueRow label={name} value={t('todo.settings.defaultList')} />
                ) : (
                  <ActionRow
                    label={name}
                    action={
                      <IconButton
                        aria-label={t('todo.settings.deleteList', { name })}
                        onPress={() => {
                          send({ kind: 'deleteList', id: list.id });
                        }}
                      >
                        <Trash2 />
                      </IconButton>
                    }
                  />
                ),
            };
          }),
          {
            id: 'todo.newList',
            node: (
              <ActionRow
                label={t('todo.settings.newList')}
                action={
                  <TextField
                    aria-label={t('todo.settings.newList')}
                    placeholder={t('todo.settings.newListPlaceholder')}
                    className="w-48"
                    leading={<Plus size={16} />}
                    value={newList}
                    onChange={setNewList}
                    onSubmit={(name) => {
                      send({ kind: 'addList', name });
                      setNewList('');
                    }}
                  />
                }
              />
            ),
          },
        ]}
      />
    </>
  );
}

/** What a fresh document reads as, for tests and stories. */
export const todoDefaults = defaultTodoSettings;
