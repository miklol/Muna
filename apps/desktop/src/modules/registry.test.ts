import { describe, expect, it } from 'vitest';

import { findModule, modules } from './registry';

describe('module registry', () => {
  it('registers the media module first (M2)', () => {
    expect(modules.map((module) => module.id)).toEqual(['media']);
    expect(findModule('media')?.titleKey).toBe('media.title');
    expect(findModule('media')?.settings).toBeDefined();
  });

  it('returns undefined for unknown ids', () => {
    expect(findModule('nope')).toBeUndefined();
  });

  it('requires unique ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
