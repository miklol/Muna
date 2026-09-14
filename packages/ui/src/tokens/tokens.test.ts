import { describe, expect, it } from 'vitest';

import { parseTokens, tokens, tokensByGroup } from './index';

describe('design tokens', () => {
  it('matches the documented token list (change docs/05-design-system.md in the same PR)', () => {
    expect(tokens.map((t) => `${t.name}: ${t.value}`)).toMatchSnapshot();
  });

  it('uses kebab-case names only', () => {
    for (const { name } of tokens) {
      expect(name).toMatch(/^--[a-z][a-z0-9]*(-+[a-z0-9]+)*$/);
    }
  });

  it('defines exactly three shadows', () => {
    expect(tokensByGroup('shadow').map((t) => t.name)).toEqual([
      '--shadow-panel',
      '--shadow-popover',
      '--shadow-drag',
    ]);
  });

  it('keeps every radius on or above the 8 px concentric floor', () => {
    for (const { name, value } of tokensByGroup('radius')) {
      const px = Number.parseFloat(value);
      expect(px, name).toBeGreaterThanOrEqual(8);
    }
  });

  it('keeps the spacing scale on the 4 px grid', () => {
    const scale = tokensByGroup('space').map((t) => Number.parseFloat(t.value));
    expect(scale).toEqual([4, 8, 12, 16, 20, 24, 32, 40]);
  });

  it('parses only the :root block and normalises whitespace', () => {
    const parsed = parseTokens(`
      :root {
        --a:   1px;
        --shadow-x: 0 1px 2px rgb(0 0 0 / 0.35),
          0 6px 16px rgb(0 0 0 / 0.35);
      }
      [data-theme="light"] { --a: 2px; }
    `);
    expect(parsed).toEqual([
      { name: '--a', value: '1px', group: 'colour' },
      {
        name: '--shadow-x',
        value: '0 1px 2px rgb(0 0 0 / 0.35), 0 6px 16px rgb(0 0 0 / 0.35)',
        group: 'shadow',
      },
    ]);
    expect(parseTokens('no root here')).toEqual([]);
  });
});
