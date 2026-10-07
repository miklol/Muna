// Contrast matrix for the design-system tokens (docs/reference/glass-ui-research.md →
// "Deeper compositing measurements"). Reads `packages/ui/src/tokens/tokens.css`, composites
// white (dark theme) or black (light theme) text at a few alphas over every surface tint,
// and prints the WCAG 2 contrast of each pair, plus every accent against `--on-accent` and
// the size of the bundled Inter subsets. Dependency-free; run from the repository root:
//
//   node scripts/research/glass-color-matrix.mjs          # tables
//   node scripts/research/glass-color-matrix.mjs --json   # raw rows on stdout
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokensPath = path.join(repoRoot, 'packages', 'ui', 'src', 'tokens', 'tokens.css');
const css = fs.readFileSync(tokensPath, 'utf8');

const block = (selector) => {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`${selector} not found in ${tokensPath}`);
  }
  return css.slice(start, css.indexOf('\n}', start));
};
const declarations = (text) =>
  Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));

const darkTokens = declarations(block(':root'));
const lightTokens = { ...darkTokens, ...declarations(block("[data-theme='light']")) };

const rgb = (hex) =>
  hex
    .slice(1)
    .match(/../g)
    .map((v) => Number.parseInt(v, 16));
const alphaOf = (value) => Number(value.match(/\/\s*([\d.]+)/)[1]);
const mix = (fg, bg, a) => fg.map((v, i) => v * a + bg[i] * (1 - a));
const luminance = (color) =>
  color
    .map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const result = { text: [], accents: [], fonts: [] };
for (const [theme, tokens] of [
  ['dark', darkTokens],
  ['light', lightTokens],
]) {
  const base = rgb(tokens[theme === 'dark' ? '--panel-bottom' : '--bg']);
  const foreground = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
  for (const surface of ['base', '--surface-1', '--surface-2', '--surface-3', '--surface-4']) {
    const alpha = surface === 'base' ? 0 : alphaOf(tokens[surface]);
    const background = mix(foreground, base, alpha);
    for (const textAlpha of [0.4, 0.46, 0.6]) {
      const value = ratio(mix(foreground, background, textAlpha), background);
      result.text.push({ theme, surface, textAlpha, ratio: value, pass: value >= 4.5 });
    }
  }
  for (const [name, value] of Object.entries(tokens)) {
    if (!name.startsWith('--accent-') || !value.startsWith('#')) {
      continue;
    }
    const contrast = ratio(rgb(value), rgb(tokens['--on-accent']));
    result.accents.push({ theme, name, ratio: contrast, pass: contrast >= 4.5 });
  }
}

const requireUi = createRequire(path.join(repoRoot, 'packages', 'ui', 'package.json'));
for (const subset of ['latin', 'latin-ext', 'cyrillic']) {
  try {
    const font = requireUi.resolve(
      `@fontsource-variable/inter/files/inter-${subset}-wght-normal.woff2`,
    );
    result.fonts.push({ subset, bytes: fs.statSync(font).size });
  } catch {
    result.fonts.push({ subset, bytes: null });
  }
}

if (process.argv.includes('--json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const rounded = (rows) => rows.map((row) => ({ ...row, ratio: row.ratio.toFixed(2) }));
  console.table(rounded(result.text));
  console.table(rounded(result.accents));
  console.table(result.fonts);
}
