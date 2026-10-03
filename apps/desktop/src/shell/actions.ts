import {
  SHELL_ACTION_IDS,
  SHELL_OPEN_MODULE_SLOTS,
  shellOpenModuleActionId,
} from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';

import { type ModuleAction, type ModuleDefinition, moduleActions } from '../modules/registry';
import type { ShellEvent } from './machine';
import type { BarModule } from './module-order';
import { resolveActive, stepModule } from './module-order';

/**
 * What a shell action may do (docs/modules/keyboard-shortcuts.md "Scope"): drive the state
 * machine, switch the module, or open the command palette. Rust already picked the notch under
 * the cursor; the component owning the machine supplies this.
 */
export interface ShellActionContext {
  readonly send: (event: ShellEvent) => void;
  readonly orderedModules: readonly BarModule[];
  readonly activeModuleId: string | null;
  readonly setActiveModule: (id: string) => void;
  readonly openPalette: () => void;
}

/**
 * One action the shell offers for binding. `run` is missing for `shell.snooze`: Rust parks the
 * notch itself when the chord fires, so the palette has nothing to run and lists it not at all.
 */
export interface ShellAction {
  readonly id: string;
  readonly labelKey: MessageKey;
  /** Interpolation for the label (`{{n}}` of "Open module {{n}}"). */
  readonly labelValues?: Readonly<Record<string, number>>;
  readonly run?: (context: ShellActionContext) => void;
}

const openOn = (context: ShellActionContext, id: string | null) => {
  context.send({ type: 'open' });
  if (id !== null && id !== resolveActive(context.orderedModules, context.activeModuleId)?.id) {
    context.setActiveModule(id);
  }
};

const openModuleAt = (n: number): ShellAction => ({
  id: shellOpenModuleActionId(n),
  labelKey: 'shortcuts.actions.openModule',
  labelValues: { n },
  run: (context) => {
    const module = context.orderedModules[n - 1];
    if (module !== undefined) {
      openOn(context, module.id);
    }
  },
});

/** The shell's actions in the order the pane and the palette list them. */
export const shellActions: readonly ShellAction[] = [
  {
    id: SHELL_ACTION_IDS.togglePanel,
    labelKey: 'shortcuts.actions.togglePanel',
    run: (context) => {
      context.send({ type: 'toggle' });
    },
  },
  {
    id: SHELL_ACTION_IDS.palette,
    labelKey: 'shortcuts.actions.palette',
    run: (context) => {
      context.send({ type: 'open' });
      context.openPalette();
    },
  },
  { id: SHELL_ACTION_IDS.snooze, labelKey: 'shortcuts.actions.snooze' },
  {
    id: SHELL_ACTION_IDS.nextModule,
    labelKey: 'shortcuts.actions.nextModule',
    run: (context) => {
      openOn(context, stepModule(context.orderedModules, context.activeModuleId, 1));
    },
  },
  {
    id: SHELL_ACTION_IDS.previousModule,
    labelKey: 'shortcuts.actions.previousModule',
    run: (context) => {
      openOn(context, stepModule(context.orderedModules, context.activeModuleId, -1));
    },
  },
  ...Array.from({ length: SHELL_OPEN_MODULE_SLOTS }, (_, index) => openModuleAt(index + 1)),
];

/** An action as the palette and the shortcuts pane list it, whichever side declared it. */
export interface ActionEntry {
  readonly id: string;
  readonly labelKey: MessageKey;
  readonly labelValues?: Readonly<Record<string, number>>;
  /** Message key of the group heading: the shell, or the module's title. */
  readonly groupKey: MessageKey;
  /** Whether the palette can run it (everything but `shell.snooze`). */
  readonly runnable: boolean;
}

/**
 * Every bindable action: the shell's, then each module's in registry order. The pane binds
 * from this list; the palette shows the runnable ones.
 */
export const listActions = (definitions: readonly ModuleDefinition[]): readonly ActionEntry[] => [
  ...shellActions.map<ActionEntry>((action) => ({
    id: action.id,
    labelKey: action.labelKey,
    ...(action.labelValues === undefined ? {} : { labelValues: action.labelValues }),
    groupKey: 'shortcuts.group.shell',
    runnable: action.run !== undefined,
  })),
  ...definitions.flatMap((module) =>
    (module.actions ?? []).map<ActionEntry>((action) => ({
      id: action.id,
      labelKey: action.labelKey,
      groupKey: module.titleKey,
      runnable: true,
    })),
  ),
];

export interface ActionRunner {
  readonly shell: ShellActionContext;
  readonly modules: readonly ModuleDefinition[];
}

/**
 * Runs the action bound to `id` — a shell action, else the module action with that id.
 * Returns `false` for an id nobody declares (a stale binding after a module was removed), so
 * the caller can ignore it quietly.
 */
export const runAction = (id: string, runner: ActionRunner): boolean => {
  const shellAction = shellActions.find((action) => action.id === id);
  if (shellAction !== undefined) {
    shellAction.run?.(runner.shell);
    return shellAction.run !== undefined;
  }
  const moduleAction: ModuleAction | undefined = moduleActions(runner.modules).find(
    (action) => action.id === id,
  );
  if (moduleAction === undefined) {
    return false;
  }
  void Promise.resolve(
    moduleAction.run({
      openModule: (moduleId) => {
        openOn(runner.shell, moduleId);
      },
    }),
  ).catch(() => {
    // The module refused or IPC is unavailable (tests, Storybook); nothing to show.
  });
  return true;
};
