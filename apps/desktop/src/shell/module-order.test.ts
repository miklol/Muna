import { describe, expect, it } from 'vitest';

import type { ModuleDefinition } from '../modules/registry';
import { orderModules, resolveActive, stepModule } from './module-order';

const Glyph = () => null;
const Body = () => null;

const module = (id: string): ModuleDefinition => ({
  id,
  // Any real key will do for ordering tests; modules bring their own titles.
  titleKey: 'app.name',
  icon: Glyph,
  panel: Body,
});

const media = module('media');
const calendar = module('calendar');
const pomodoro = module('pomodoro');
const all = [media, calendar, pomodoro];

describe('orderModules', () => {
  it('keeps registry order without a saved order', () => {
    expect(orderModules(all, [])).toEqual(all);
  });

  it('follows the saved order, drops unknown ids and appends new modules', () => {
    expect(orderModules(all, ['pomodoro', 'removed', 'media'])).toEqual([
      pomodoro,
      media,
      calendar,
    ]);
  });

  it('leaves disabled modules out wherever the order puts them', () => {
    expect(orderModules(all, ['pomodoro', 'media'], ['pomodoro'])).toEqual([media, calendar]);
    expect(orderModules(all, [], ['media', 'calendar', 'pomodoro'])).toEqual([]);
  });

  it('skips modules without a panel: they have no tab to order', () => {
    const hud: ModuleDefinition = { id: 'hud', titleKey: 'app.name', icon: Glyph };
    expect(orderModules([media, hud, calendar], ['hud', 'calendar'])).toEqual([calendar, media]);
    expect(orderModules([hud], [])).toEqual([]);
  });
});

describe('resolveActive', () => {
  it('returns the chosen module, else the first, else nothing', () => {
    expect(resolveActive(all, 'calendar')).toBe(calendar);
    expect(resolveActive(all, 'missing')).toBe(media);
    expect(resolveActive(all, null)).toBe(media);
    expect(resolveActive([], 'media')).toBeNull();
  });
});

describe('stepModule', () => {
  it('wraps around the bar in both directions', () => {
    expect(stepModule(all, 'media', 1)).toBe('calendar');
    expect(stepModule(all, 'pomodoro', 1)).toBe('media');
    expect(stepModule(all, 'media', -1)).toBe('pomodoro');
    expect(stepModule(all, null, 1)).toBe('calendar');
  });

  it('has nowhere to go with fewer than two modules', () => {
    expect(stepModule([media], 'media', 1)).toBeNull();
    expect(stepModule([], null, 1)).toBeNull();
  });
});
