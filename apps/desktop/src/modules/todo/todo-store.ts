import type { Task, TaskList, TodoSnapshot } from '@muna/contracts';
import { create } from 'zustand';

export interface TodoStore {
  /** Last `TodoChanged`; `null` until the first snapshot arrives. */
  snapshot: TodoSnapshot | null;
  /** `Date.now()` when `snapshot` arrived; due labels and the overdue tint read time from here. */
  receivedAt: number;
  /**
   * Set by the `todo.quickAdd` action (a global shortcut or the palette) before the panel opens;
   * the panel focuses its add field and clears it once the snapshot has arrived.
   */
  quickAddPending: boolean;
  setSnapshot: (snapshot: TodoSnapshot, at?: number) => void;
  requestQuickAdd: () => void;
  consumeQuickAdd: () => void;
}

/**
 * The to-do module's mirror of the Rust task store (docs/modules/todo.md). Fed by
 * `useTodoSubscription` while the panel or the settings pane is mounted; the strip never needs
 * it because the next due task arrives through `StripContentChanged`. Nothing here polls.
 */
export const useTodoStore = create<TodoStore>()((set) => ({
  snapshot: null,
  receivedAt: 0,
  quickAddPending: false,
  setSnapshot: (snapshot, at = Date.now()) => {
    set({ snapshot, receivedAt: at });
  },
  requestQuickAdd: () => {
    set({ quickAddPending: true });
  },
  consumeQuickAdd: () => {
    set({ quickAddPending: false });
  },
}));

/** Lists in their stored order; the default list (`name === null`) comes first. */
export const orderedLists = (lists: readonly TaskList[]): TaskList[] =>
  [...lists].sort((a, b) => a.sortOrder - b.sortOrder);

/** Open tasks of `listId` in their stored order, then completed ones (latest first). */
export const listTasks = (tasks: readonly Task[], listId: string): Task[] => {
  const own = tasks.filter((task) => task.listId === listId && task.deletedAtMs === null);
  const open = own.filter((task) => task.completedAtMs === null);
  const done = own.filter((task) => task.completedAtMs !== null);
  open.sort((a, b) => a.sortOrder - b.sortOrder);
  done.sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0));
  return [...open, ...done];
};

/** Every task in the trash, latest deletion first. */
export const trashedTasks = (tasks: readonly Task[]): Task[] =>
  tasks
    .filter((task) => task.deletedAtMs !== null)
    .sort((a, b) => (b.deletedAtMs ?? 0) - (a.deletedAtMs ?? 0));
