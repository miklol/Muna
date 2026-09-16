import type { MessageKey } from '@muna/i18n';
import type { ComponentType } from 'react';

/** What the shell passes to a module's glyph: 20 px in the module bar, 16 px in the right rail. */
export interface ModuleIconProps {
  readonly size?: number;
  readonly strokeWidth?: number;
}

/**
 * Frontend half of the module contract (ADR-0004). A module registers here and in
 * `src-tauri/src/modules/mod.rs`; modules never import each other.
 */
export interface ModuleDefinition {
  /** Stable id, also the settings namespace and the Rust module id. */
  readonly id: string;
  /** Message key of the module title (the panel's accessible name and the bar tab's label). */
  readonly titleKey: MessageKey;
  /** Glyph for the module bar tab (a Lucide icon fits). */
  readonly icon: ComponentType<ModuleIconProps>;
  /** The expanded-panel body; mounted only while the module is the active one. */
  readonly panel: ComponentType;
  /** Lazy settings section; loaded on first expand to keep the idle bundle small. */
  readonly settings?: () => Promise<{ default: ComponentType }>;
}

export const modules: readonly ModuleDefinition[] = [];

export const findModule = (id: string): ModuleDefinition | undefined =>
  modules.find((module) => module.id === id);
