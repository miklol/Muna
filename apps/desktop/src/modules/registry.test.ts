import { describe, expect, it } from 'vitest';

import { dropModuleOf, findModule, modules } from './registry';

describe('module registry', () => {
  it('registers the dashboard first (M3-E9), then the media and HUD modules (M2), the calendar, notifications, to-do, pomodoro, system monitor, Bluetooth, weather and day-progress modules (M3), keyboard shortcuts and drop actions (M4)', () => {
    expect(modules.map((module) => module.id)).toEqual([
      'dashboard',
      'media',
      'calendar',
      'notifications',
      'todo',
      'pomodoro',
      'system-monitor',
      'bluetooth',
      'weather',
      'day-progress',
      'hud',
      'keyboard-shortcuts',
      'drop-actions',
    ]);
    expect(findModule('dashboard')?.titleKey).toBe('dashboard.title');
    expect(findModule('dashboard')?.settings).toBeDefined();
    expect(findModule('dashboard')?.panel).toBeDefined();
    expect(findModule('media')?.titleKey).toBe('media.title');
    expect(findModule('media')?.settings).toBeDefined();
    expect(findModule('media')?.panel).toBeDefined();
    expect(findModule('calendar')?.titleKey).toBe('calendar.title');
    expect(findModule('calendar')?.settings).toBeDefined();
    expect(findModule('calendar')?.panel).toBeDefined();
    expect(findModule('notifications')?.titleKey).toBe('notifications.title');
    expect(findModule('notifications')?.settings).toBeDefined();
    expect(findModule('notifications')?.panel).toBeDefined();
    expect(findModule('todo')?.titleKey).toBe('todo.title');
    expect(findModule('todo')?.settings).toBeDefined();
    expect(findModule('todo')?.panel).toBeDefined();
    expect(findModule('pomodoro')?.titleKey).toBe('pomodoro.title');
    expect(findModule('pomodoro')?.settings).toBeDefined();
    expect(findModule('pomodoro')?.panel).toBeDefined();
    expect(findModule('system-monitor')?.titleKey).toBe('systemMonitor.title');
    expect(findModule('system-monitor')?.settings).toBeDefined();
    expect(findModule('system-monitor')?.panel).toBeDefined();
    expect(findModule('bluetooth')?.titleKey).toBe('bluetooth.title');
    expect(findModule('bluetooth')?.settings).toBeDefined();
    expect(findModule('bluetooth')?.panel).toBeDefined();
    expect(findModule('weather')?.titleKey).toBe('weather.title');
    expect(findModule('weather')?.settings).toBeDefined();
    expect(findModule('weather')?.panel).toBeDefined();
    expect(findModule('day-progress')?.titleKey).toBe('dayProgress.title');
    expect(findModule('day-progress')?.settings).toBeDefined();
    expect(findModule('day-progress')?.panel).toBeDefined();
  });

  it('gives the HUD a settings pane but no panel: it lives in the strip', () => {
    expect(findModule('hud')?.titleKey).toBe('hud.title');
    expect(findModule('hud')?.settings).toBeDefined();
    expect(findModule('hud')?.panel).toBeUndefined();
  });

  it('gives keyboard shortcuts a settings pane but no panel: the palette is a shell surface', () => {
    expect(findModule('keyboard-shortcuts')?.titleKey).toBe('shortcuts.title');
    expect(findModule('keyboard-shortcuts')?.settings).toBeDefined();
    expect(findModule('keyboard-shortcuts')?.panel).toBeUndefined();
    expect(findModule('keyboard-shortcuts')?.actions).toBeUndefined();
  });

  it("gives drop actions a settings pane and the drop row but no panel: the row is the shell's drop state", () => {
    expect(findModule('drop-actions')?.titleKey).toBe('dropActions.title');
    expect(findModule('drop-actions')?.settings).toBeDefined();
    expect(findModule('drop-actions')?.panel).toBeUndefined();
    expect(findModule('drop-actions')?.drop).toBeDefined();
    expect(dropModuleOf(modules)?.id).toBe('drop-actions');
    expect(dropModuleOf(modules.filter((module) => module.id !== 'drop-actions'))).toBeUndefined();
  });

  it('declares the M4-E6 module actions on the media, to-do and pomodoro modules only', () => {
    const withActions = modules
      .filter((module) => module.actions !== undefined)
      .map((module) => [module.id, module.actions?.map((action) => action.id)]);
    expect(withActions).toEqual([
      ['media', ['media.playPause']],
      ['todo', ['todo.quickAdd']],
      ['pomodoro', ['pomodoro.toggle']],
    ]);
  });

  it('gives every P1 module with a dashboard card a widget, and the dashboard, notifications and HUD none', () => {
    const withWidget = modules.filter((module) => module.widget !== undefined).map((m) => m.id);
    expect(withWidget).toEqual([
      'media',
      'calendar',
      'todo',
      'pomodoro',
      'system-monitor',
      'bluetooth',
      'weather',
      'day-progress',
    ]);
  });

  it('returns undefined for unknown ids', () => {
    expect(findModule('nope')).toBeUndefined();
  });

  it('requires unique ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
