import { describe, expect, it } from 'vitest';

import { findModule, modules } from './registry';

describe('module registry', () => {
  it('registers the media and HUD modules (M2) and the pomodoro module (M3)', () => {
    expect(modules.map((module) => module.id)).toEqual(['media', 'pomodoro', 'hud']);
    expect(findModule('media')?.titleKey).toBe('media.title');
    expect(findModule('media')?.settings).toBeDefined();
    expect(findModule('media')?.panel).toBeDefined();
    expect(findModule('pomodoro')?.titleKey).toBe('pomodoro.title');
    expect(findModule('pomodoro')?.settings).toBeDefined();
    expect(findModule('pomodoro')?.panel).toBeDefined();
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
