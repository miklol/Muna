import type { ComponentType } from 'react';

/**
 * Frontend half of the module contract (ADR-0004). A module registers here and in
 * `src-tauri/src/modules/mod.rs`; modules never import each other.
 */
export interface ModuleDefinition {
  /** Stable id, also the settings namespace and the Rust module id. */
  readonly id: string;
  /** i18n key of the module title. */
  readonly titleKey: string;
  /** Lazy settings section; loaded on first expand to keep the idle bundle small. */
  readonly settings?: () => Promise<{ default: ComponentType }>;
}

export const modules: readonly ModuleDefinition[] = [];

export const findModule = (id: string): ModuleDefinition | undefined =>
  modules.find((module) => module.id === id);
