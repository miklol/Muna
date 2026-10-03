import { describe, expect, it } from 'vitest';

import { findModule, modules } from './registry';

describe('module registry', () => {
  it('registers the media and HUD modules (M2) and the to-do, pomodoro, system monitor, Bluetooth and weather modules (M3)', () => {
    expect(modules.map((module) => module.id)).toEqual([
      'media',
      'todo',
      'pomodoro',
      'system-monitor',
      'bluetooth',
      'weather',
      'hud',
    ]);
    expect(findModule('media')?.titleKey).toBe('media.title');
    expect(findModule('media')?.settings).toBeDefined();
    expect(findModule('media')?.panel).toBeDefined();
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
  });

  it('gives the HUD a settings pane but no panel: it lives in the strip', () => {
    expect(findModule('hud')?.titleKey).toBe('hud.title');
    expect(findModule('hud')?.settings).toBeDefined();
    expect(findModule('hud')?.panel).toBeUndefined();
  });

  it('returns undefined for unknown ids', () => {
    expect(findModule('nope')).toBeUndefined();
  });

  it('requires unique ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
