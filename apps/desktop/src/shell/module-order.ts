import type { ModuleDefinition } from '../modules/registry';

/**
 * Bar order: the saved order first (ids the registry no longer knows are dropped), then any
 * module the order has not seen yet in registry order — a freshly added module appears at the
 * end rather than nowhere.
 */
export const orderModules = (
  definitions: readonly ModuleDefinition[],
  order: readonly string[],
): readonly ModuleDefinition[] => {
  const byId = new Map(definitions.map((module) => [module.id, module] as const));
  const ordered: ModuleDefinition[] = [];
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
export const resolveActive = (
  ordered: readonly ModuleDefinition[],
  activeId: string | null,
): ModuleDefinition | null =>
  ordered.find((module) => module.id === activeId) ?? ordered[0] ?? null;

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
