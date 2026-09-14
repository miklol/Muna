/**
 * Reads the design tokens out of `tokens.css` at build time so Storybook, tests and tooling
 * can list them without a second source of truth.
 */
import tokensCss from './tokens.css?raw';

export type TokenGroup =
  'colour' | 'material' | 'shadow' | 'radius' | 'space' | 'size' | 'type' | 'focus';

export interface Token {
  /** Custom property name including the leading dashes, e.g. `--radius-panel`. */
  name: string;
  /** Raw CSS value as written in `tokens.css`. */
  value: string;
  group: TokenGroup;
}

const declaration = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;

const groupOf = (name: string): TokenGroup => {
  if (name.startsWith('--shadow-')) return 'shadow';
  if (name.startsWith('--radius-')) return 'radius';
  if (name.startsWith('--space-')) return 'space';
  if (name.startsWith('--size-')) return 'size';
  if (name.startsWith('--focus-')) return 'focus';
  if (name.startsWith('--material-') || name === '--catch-light') return 'material';
  if (name.startsWith('--text-') && !/^--text-[123]$/.test(name)) return 'type';
  if (name.startsWith('--font-')) return 'type';
  return 'colour';
};

/** The `:root` block only — theme and contrast overrides re-declare existing names. */
const rootBlock = (css: string): string => {
  const start = css.indexOf(':root');
  const open = css.indexOf('{', start);
  const close = css.indexOf('}', open);
  return start === -1 || open === -1 || close === -1 ? '' : css.slice(open + 1, close);
};

export const parseTokens = (css: string): Token[] => {
  const tokens: Token[] = [];
  for (const match of rootBlock(css).matchAll(declaration)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    tokens.push({ name, value: value.replace(/\s+/g, ' ').trim(), group: groupOf(name) });
  }
  return tokens;
};

export const tokens: readonly Token[] = parseTokens(tokensCss);

export const tokensByGroup = (group: TokenGroup): Token[] =>
  tokens.filter((t) => t.group === group);
