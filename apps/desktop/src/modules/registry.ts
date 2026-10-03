import type { MessageKey } from '@muna/i18n';
import type { ComponentType } from 'react';

import { bluetoothModule } from './bluetooth';
import { hudModule } from './hud';
import { mediaModule } from './media';
import { pomodoroModule } from './pomodoro';
import { systemMonitorModule } from './system-monitor';
import { todoModule } from './todo';
import { weatherModule } from './weather';

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
  /**
   * The expanded-panel body; mounted only while the module is the active one. A module
   * without one (the HUD) lives in the strip and Settings only: it takes no bar tab and the
   * Modules pane does not list it.
   */
  readonly panel?: ComponentType;
  /**
   * Settings section, shown as the module's own pane in the settings window. Declare it as
   * `lazy(() => import('./settings'))` at module scope so the chunk loads on first visit and
   * the idle bundle stays small; the window wraps it in `Suspense`.
   */
  readonly settings?: ComponentType;
}

/** Every module, in default order; Settings → Modules reorders and disables from here. */
export const modules: readonly ModuleDefinition[] = [
  mediaModule,
  todoModule,
  pomodoroModule,
  systemMonitorModule,
  bluetoothModule,
  weatherModule,
  hudModule,
];

export const findModule = (id: string): ModuleDefinition | undefined =>
  modules.find((module) => module.id === id);
