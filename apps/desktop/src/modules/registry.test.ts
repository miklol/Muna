import { describe, expect, it } from 'vitest';

import { findModule, modules } from './registry';

describe('module registry', () => {
  it('starts empty until the first module lands (M1)', () => {
    expect(modules).toEqual([]);
  });

  it('returns undefined for unknown ids', () => {
    expect(findModule('media')).toBeUndefined();
  });

  it('requires unique ids', () => {
    const ids = modules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
