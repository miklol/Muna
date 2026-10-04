import { describe, expect, it } from 'vitest';

import { dropModuleOf, findModule, modules, snapModuleOf } from './registry';

describe('module registry', () => {
  it('registers the dashboard first (M3-E9), then the media and HUD modules (M2), the calendar, notifications, to-do, pomodoro, system monitor, Bluetooth, weather and day-progress modules (M3), keyboard shortcuts, drop actions, the shelf, window snap, code hosting, notes, screen time and AI coding (M4), then health, mirror and support (M5)', () => {
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
      'shelf',
      'window-snap',
      'code-hosting',
      'notes',
      'screen-time',
      'ai-coding',
      'health',
      'mirror',
      'support',
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
    expect(findModule('shelf')?.titleKey).toBe('shelf.title');
    expect(findModule('shelf')?.settings).toBeDefined();
    expect(findModule('shelf')?.panel).toBeDefined();
    expect(findModule('code-hosting')?.titleKey).toBe('codeHosting.title');
    expect(findModule('code-hosting')?.settings).toBeDefined();
    expect(findModule('code-hosting')?.panel).toBeDefined();
    expect(findModule('notes')?.titleKey).toBe('notes.title');
    expect(findModule('notes')?.settings).toBeDefined();
    expect(findModule('notes')?.panel).toBeDefined();
    expect(findModule('screen-time')?.titleKey).toBe('screenTime.title');
    expect(findModule('screen-time')?.settings).toBeDefined();
    expect(findModule('screen-time')?.panel).toBeDefined();
    expect(findModule('ai-coding')?.titleKey).toBe('aiCoding.title');
    expect(findModule('ai-coding')?.settings).toBeDefined();
    expect(findModule('ai-coding')?.panel).toBeDefined();
    expect(findModule('health')?.titleKey).toBe('health.title');
    expect(findModule('health')?.settings).toBeDefined();
    expect(findModule('health')?.panel).toBeDefined();
    expect(findModule('mirror')?.titleKey).toBe('mirror.title');
    expect(findModule('mirror')?.settings).toBeDefined();
    expect(findModule('mirror')?.panel).toBeDefined();
    expect(findModule('mirror')?.actions).toBeUndefined();
    expect(findModule('support')?.titleKey).toBe('support.title');
    expect(findModule('support')?.settings).toBeDefined();
    expect(findModule('support')?.panel).toBeDefined();
    expect(findModule('support')?.widget).toBeUndefined();
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

  it("gives window snap a settings pane and the zones but no panel: the zones are the shell's snap state", () => {
    expect(findModule('window-snap')?.titleKey).toBe('windowSnap.title');
    expect(findModule('window-snap')?.settings).toBeDefined();
    expect(findModule('window-snap')?.panel).toBeUndefined();
    expect(findModule('window-snap')?.drop).toBeUndefined();
    expect(findModule('window-snap')?.snap).toBeDefined();
    expect(snapModuleOf(modules)?.id).toBe('window-snap');
    expect(snapModuleOf(modules.filter((module) => module.id !== 'window-snap'))).toBeUndefined();
  });

  it('declares the module actions on the media, to-do, pomodoro, code-hosting, notes and health modules only', () => {
    const withActions = modules
      .filter((module) => module.actions !== undefined)
      .map((module) => [module.id, module.actions?.map((action) => action.id)]);
    expect(withActions).toEqual([
      ['media', ['media.playPause']],
      ['todo', ['todo.quickAdd']],
      ['pomodoro', ['pomodoro.toggle']],
      ['code-hosting', ['code-hosting.refresh']],
      ['notes', ['notes.quickNote']],
      ['health', ['health.water', 'health.breathe']],
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
      'code-hosting',
      'notes',
      'screen-time',
      'ai-coding',
      'health',
      'mirror',
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
