import type { ModuleDefinition } from '../modules/registry';

/** A module the bar can show: it has a panel body to switch to. */
export interface BarModule extends ModuleDefinition {
  readonly panel: NonNullable<ModuleDefinition['panel']>;
}

const hasPanel = (module: ModuleDefinition): module is BarModule => module.panel !== undefined;

/**
 * Bar order: the saved order first (ids the registry no longer knows are dropped), then any
 * module the order has not seen yet in registry order — a freshly added module appears at the
 * end rather than nowhere. Disabled ids are left out entirely (Settings → Modules), and so are
 * modules without a panel (the HUD): they have no tab to order.
 */
export const orderModules = (
  definitions: readonly ModuleDefinition[],
  order: readonly string[],
  disabled: readonly string[] = [],
): readonly BarModule[] => {
  const byId = new Map(
    definitions
      .filter(hasPanel)
      .filter((module) => !disabled.includes(module.id))
      .map((module) => [module.id, module] as const),
  );
  const ordered: BarModule[] = [];
  for (const id of order) {
    const module = byId.get(id);
    if (module !== undefined) {
      ordered.push(module);
      byId.delete(id);
    }
  }
  return [...ordered, ...byId.values()];
};

/** The module the panel shows: the chosen one when it exists, else the first, else nothing. */
export const resolveActive = <M extends ModuleDefinition>(
  ordered: readonly M[],
  activeId: string | null,
): M | null => ordered.find((module) => module.id === activeId) ?? ordered[0] ?? null;

/** The id `delta` tabs away from the active module, wrapping (`Ctrl+Tab` / `Ctrl+Shift+Tab`). */
export const stepModule = (
  ordered: readonly ModuleDefinition[],
  activeId: string | null,
  delta: 1 | -1,
): string | null => {
  const active = resolveActive(ordered, activeId);
  if (active === null || ordered.length < 2) {
    return null;
  }
  const index = ordered.indexOf(active);
  const next = ordered[(index + delta + ordered.length) % ordered.length];
  return next === undefined ? null : next.id;
};
