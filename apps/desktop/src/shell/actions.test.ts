import { SHELL_ACTION_IDS, shellOpenModuleActionId } from '@muna/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { ModuleAction, ModuleDefinition } from '../modules/registry';
import { listActions, runAction, type ShellActionContext, shellActions } from './actions';
import type { ShellEvent } from './machine';
import type { BarModule } from './module-order';

const Icon = () => null;
const Panel = () => null;

const bar = (id: string): BarModule => ({ id, titleKey: 'todo.title', icon: Icon, panel: Panel });

const context = (
  orderedModules: readonly BarModule[],
  activeModuleId: string | null,
): ShellActionContext & { sent: ShellEvent[] } => {
  const sent: ShellEvent[] = [];
  return {
    sent,
    send: (event) => {
      sent.push(event);
    },
    orderedModules,
    activeModuleId,
    setActiveModule: vi.fn(),
    openPalette: vi.fn(),
  };
};

const withAction = (run: ModuleAction['run']): ModuleDefinition => ({
  id: 'todo',
  titleKey: 'todo.title',
  icon: Icon,
  actions: [{ id: 'todo.quickAdd', labelKey: 'todo.actions.quickAdd', run }],
});

describe('shellActions', () => {
  it('lists the five named actions, then one open-module slot per number', () => {
    expect(shellActions.map((action) => action.id)).toEqual([
      SHELL_ACTION_IDS.togglePanel,
      SHELL_ACTION_IDS.palette,
      SHELL_ACTION_IDS.snooze,
      SHELL_ACTION_IDS.nextModule,
      SHELL_ACTION_IDS.previousModule,
      ...Array.from({ length: 9 }, (_, index) => shellOpenModuleActionId(index + 1)),
    ]);
    expect(shellActions.find((action) => action.id === shellOpenModuleActionId(3))).toMatchObject({
      labelKey: 'shortcuts.actions.openModule',
      labelValues: { n: 3 },
    });
  });

  it('toggles, opens with the palette, steps and opens by number through the machine', () => {
    const modules = [bar('a'), bar('b'), bar('c')];
    const ctx = context(modules, 'b');

    expect(runAction(SHELL_ACTION_IDS.togglePanel, { shell: ctx, modules })).toBe(true);
    expect(ctx.sent).toEqual([{ type: 'toggle' }]);

    ctx.sent.length = 0;
    runAction(SHELL_ACTION_IDS.palette, { shell: ctx, modules });
    expect(ctx.sent).toEqual([{ type: 'open' }]);
    expect(ctx.openPalette).toHaveBeenCalledTimes(1);

    ctx.sent.length = 0;
    runAction(SHELL_ACTION_IDS.nextModule, { shell: ctx, modules });
    expect(ctx.sent).toEqual([{ type: 'open' }]);
    expect(ctx.setActiveModule).toHaveBeenLastCalledWith('c');
    runAction(SHELL_ACTION_IDS.previousModule, { shell: ctx, modules });
    expect(ctx.setActiveModule).toHaveBeenLastCalledWith('a');

    runAction(shellOpenModuleActionId(1), { shell: ctx, modules });
    expect(ctx.setActiveModule).toHaveBeenLastCalledWith('a');
    // Already the active module: the panel opens but nothing is re-selected.
    vi.mocked(ctx.setActiveModule).mockClear();
    runAction(shellOpenModuleActionId(2), { shell: ctx, modules });
    expect(ctx.setActiveModule).not.toHaveBeenCalled();
    // No module in that slot: nothing happens at all.
    ctx.sent.length = 0;
    runAction(shellOpenModuleActionId(7), { shell: ctx, modules });
    expect(ctx.sent).toEqual([]);
  });

  it('snooze has nothing to run here: Rust parks the notch itself', () => {
    const ctx = context([], null);
    expect(runAction(SHELL_ACTION_IDS.snooze, { shell: ctx, modules: [] })).toBe(false);
    expect(ctx.sent).toEqual([]);
  });
});

describe('listActions and runAction with modules', () => {
  it('groups the shell first, then each module under its title, and marks what the palette can run', () => {
    const entries = listActions([withAction(() => undefined)]);
    expect(entries.filter((entry) => entry.groupKey === 'shortcuts.group.shell')).toHaveLength(14);
    expect(entries.find((entry) => entry.id === SHELL_ACTION_IDS.snooze)?.runnable).toBe(false);
    expect(entries.at(-1)).toEqual({
      id: 'todo.quickAdd',
      labelKey: 'todo.actions.quickAdd',
      groupKey: 'todo.title',
      runnable: true,
    });
  });

  it('runs a module action with an openModule that opens the panel on that module', () => {
    const run = vi.fn((actionContext: { openModule: (id: string) => void }) => {
      actionContext.openModule('todo');
    });
    const modules = [bar('dashboard'), { ...bar('todo'), ...withAction(run) }];
    const ctx = context(modules, 'dashboard');

    expect(runAction('todo.quickAdd', { shell: ctx, modules })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(ctx.sent).toEqual([{ type: 'open' }]);
    expect(ctx.setActiveModule).toHaveBeenCalledWith('todo');
  });

  it('ignores an id nobody declares, such as a binding left over from a removed module', () => {
    const ctx = context([], null);
    expect(runAction('ghost.action', { shell: ctx, modules: [] })).toBe(false);
  });
});
