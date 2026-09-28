import { describe, expect, it } from 'vitest';

import { findModule, modules } from './registry';

describe('module registry', () => {
  it('registers the dashboard first (M3-E9), then the media and HUD modules (M2) and the calendar, notifications, to-do, pomodoro, system monitor, Bluetooth, weather and day-progress modules (M3)', () => {
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
