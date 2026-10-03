import { lazy } from 'react';

import type { ModuleDefinition } from '../registry';
import { TodoPanel } from './panel';
import { useTodoStore } from './todo-store';
import { TodoWidget } from './widget';
import { TodoIcon } from './todo-icon';

/** Settings → Tasks loads on first visit so the notch bundle stays small. */
const TodoSettings = lazy(() =>
  import('./settings').then((module) => ({ default: module.TodoSettingsPane })),
);

/**
 * The to-do module's frontend half (docs/modules/todo.md; ADR-0004). Its Rust half is
 * `src-tauri/src/modules/todo`; the id is the settings namespace both sides read. Its one
 * action, "Add a task", opens the panel with the caret in the add field (keyboard-shortcuts).
 */
export const todoModule: ModuleDefinition = {
  id: 'todo',
  titleKey: 'todo.title',
  icon: TodoIcon,
  panel: TodoPanel,
  widget: TodoWidget,
  settings: TodoSettings,
  actions: [
    {
      id: 'todo.quickAdd',
      labelKey: 'todo.actions.quickAdd',
      run: ({ openModule }) => {
        useTodoStore.getState().requestQuickAdd();
        openModule('todo');
      },
    },
  ],
};
