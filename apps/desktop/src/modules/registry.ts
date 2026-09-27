import type { DropItem, DropPoint } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import type { ComponentType } from 'react';

import { aiCodingModule } from './ai-coding';
import { bluetoothModule } from './bluetooth';
import { calendarModule } from './calendar';
import { codeHostingModule } from './code-hosting';
import { dashboardModule } from './dashboard';
import { dayProgressModule } from './day-progress';
import { dropActionsModule } from './drop-actions';
import { hudModule } from './hud';
import { keyboardShortcutsModule } from './keyboard-shortcuts';
import { mediaModule } from './media';
import { notesModule } from './notes';
import { notificationsModule } from './notifications';
import { pomodoroModule } from './pomodoro';
import { screenTimeModule } from './screen-time';
import { shelfModule } from './shelf';
import { systemMonitorModule } from './system-monitor';
import { todoModule } from './todo';
import { weatherModule } from './weather';
import { windowSnapModule } from './window-snap';

/** What the shell passes to a module's glyph: 20 px in the module bar, 16 px in the right rail. */
export interface ModuleIconProps {
  readonly size?: number;
  readonly strokeWidth?: number;
}

/**
 * What the dashboard passes to a module's widget: how many of the grid's four columns the
 * card spans (docs/modules/dashboard.md "Reference": widgets span 1–2 slots). The card, its
 * header and its size are the dashboard's; the widget renders the body only.
 */
export interface WidgetProps {
  readonly span: 1 | 2;
}

/**
 * What the shell hands a module action when it runs (docs/modules/keyboard-shortcuts.md):
 * the panel controls a module cannot reach on its own. Actions run from a global hotkey or the
 * command palette, on whichever notch the cursor is over.
 */
export interface ModuleActionContext {
  /** Opens the panel on the module (a no-op when it is already showing it). */
  readonly openModule: (id: string) => void;
}

/**
 * One thing a module can do on request — bindable to a global hotkey in Settings › Keyboard
 * shortcuts and listed in the command palette. Ids are `<module>.<verb>` (`todo.quickAdd`);
 * they are what the settings document stores, so they never change once shipped.
 */
export interface ModuleAction {
  readonly id: string;
  /** Message key of the label the palette and the shortcuts pane show. */
  readonly labelKey: MessageKey;
  readonly run: (context: ModuleActionContext) => void | Promise<void>;
}

/**
 * What the shell hands the drop row while files are dragged over the notch
 * (docs/modules/drop-actions.md). The row lays out at its natural size inside the morphing
 * surface — the shell measures it and animates to match — hit-tests `position` against its own
 * tiles, and runs or cancels the drop itself; `onDone` hands the notch back to the strip.
 */
export interface DropSurfaceProps {
  readonly session: number;
  readonly items: readonly DropItem[];
  /** The drag's pointer in this window's CSS px, live; the tile under it highlights. */
  readonly position: DropPoint;
  /** `true` once the items were released at `position`. */
  readonly dropped: boolean;
  /** The widest the row may lay out (the panel's width for this monitor). */
  readonly maxWidth: number;
  /** The row has run or cancelled the drop (or was told the drag left): collapse. */
  readonly onDone: () => void;
}

/**
 * What the shell hands the snap zones while a window is dragged near the notch
 * (docs/modules/window-snap.md). Like the drop row, the zones lay out at their natural size,
 * hit-test `position` against their own tiles and, once the drag has `ended` over this window,
 * place the window or cancel the session themselves; `onDone` hands the notch back.
 */
export interface SnapSurfaceProps {
  readonly session: number;
  /** The drag's cursor in this window's CSS px, live; the zone under it highlights. */
  readonly position: DropPoint;
  /** `true` once the button went up over this window: apply the hovered zone, or cancel. */
  readonly ended: boolean;
  /** The widest the zones may lay out (the panel's width for this monitor). */
  readonly maxWidth: number;
  /** The zones have placed the window or cancelled: collapse. */
  readonly onDone: () => void;
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
   * The module's dashboard card body (docs/modules/dashboard.md "Widgets"); mounted only
   * while the dashboard shows it, so it subscribes on mount and unlistens on unmount like a
   * panel. The dashboard supplies the card, header and size.
   */
  readonly widget?: ComponentType<WidgetProps>;
  /**
   * Settings section, shown as the module's own pane in the settings window. Declare it as
   * `lazy(() => import('./settings'))` at module scope so the chunk loads on first visit and
   * the idle bundle stays small; the window wraps it in `Suspense`.
   */
  readonly settings?: ComponentType;
  /**
   * Actions other surfaces may trigger (docs/modules/keyboard-shortcuts.md): each becomes a
   * row in Settings › Keyboard shortcuts and an entry in the command palette. Unbound by
   * default; the user picks the chords.
   */
  readonly actions?: readonly ModuleAction[];
  /**
   * What the notch shows while files are dragged over it (docs/modules/drop-actions.md); at
   * most one enabled module provides it. Mounted for the drag only, so it subscribes on mount
   * like a panel. Disabling the module in Settings › Modules turns drops off with it.
   */
  readonly drop?: ComponentType<DropSurfaceProps>;
  /**
   * What the notch shows while a window is dragged near it (docs/modules/window-snap.md); at
   * most one enabled module provides it. Mounted for the drag only. Disabling the module in
   * Settings › Modules turns snapping off with it, on both sides.
   */
  readonly snap?: ComponentType<SnapSurfaceProps>;
}

/** Every action the registered modules declare, in module order. */
export const moduleActions = (definitions: readonly ModuleDefinition[]): readonly ModuleAction[] =>
  definitions.flatMap((module) => module.actions ?? []);

/** The first module (in order) that provides a drop row, if any is enabled. */
export const dropModuleOf = (
  definitions: readonly ModuleDefinition[],
): ModuleDefinition | undefined => definitions.find((module) => module.drop !== undefined);

/** The first module (in order) that provides snap zones, if any is enabled. */
export const snapModuleOf = (
  definitions: readonly ModuleDefinition[],
): ModuleDefinition | undefined => definitions.find((module) => module.snap !== undefined);

/**
 * Every module, in default order; Settings → Modules reorders and disables from here. The
 * dashboard comes first: it is the panel most users open (docs/modules/dashboard.md "the
 * default module for most users").
 */
export const modules: readonly ModuleDefinition[] = [
  dashboardModule,
  mediaModule,
  calendarModule,
  notificationsModule,
  todoModule,
  pomodoroModule,
  systemMonitorModule,
  bluetoothModule,
  weatherModule,
  dayProgressModule,
  hudModule,
  keyboardShortcutsModule,
  dropActionsModule,
  shelfModule,
  windowSnapModule,
  codeHostingModule,
  notesModule,
  screenTimeModule,
  aiCodingModule,
];

export const findModule = (id: string): ModuleDefinition | undefined =>
  modules.find((module) => module.id === id);
