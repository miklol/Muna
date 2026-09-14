// Message catalog checks (docs/11-ci-cd.md quality gates, docs/05 UX copy rules):
//   1. every locale has exactly the keys of en.json (no missing, no extra);
//   2. no empty strings;
//   3. no exclamation marks in English copy;
//   4. every `t('key')` literal used by the apps exists in en.json.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './lib.mjs';

const localesDir = path.join(repoRoot, 'packages', 'i18n', 'src', 'locales');
const sourceDirs = [
  path.join(repoRoot, 'apps', 'desktop', 'src'),
  path.join(repoRoot, 'packages', 'ui', 'src'),
];

function flatten(value, prefix = '') {
  const out = new Map();
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      out.set(full, child);
    } else if (child && typeof child === 'object') {
      for (const [k, v] of flatten(child, full)) out.set(k, v);
    } else {
      throw new Error(`${full}: values must be strings or objects`);
    }
  }
  return out;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|stories)\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

const problems = [];
const locales = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
const en = flatten(JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf8')));

for (const [key, text] of en) {
  if (text.trim() === '') problems.push(`en.json: ${key} is empty`);
  if (text.includes('!')) problems.push(`en.json: ${key} contains an exclamation mark`);
}

for (const file of locales) {
  if (file === 'en.json') continue;
  const other = flatten(JSON.parse(readFileSync(path.join(localesDir, file), 'utf8')));
  for (const key of en.keys()) if (!other.has(key)) problems.push(`${file}: missing ${key}`);
  for (const [key, text] of other) {
    if (!en.has(key)) problems.push(`${file}: unknown key ${key}`);
    if (text.trim() === '') problems.push(`${file}: ${key} is empty`);
  }
}

const keyPattern = /\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
for (const dir of sourceDirs) {
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(keyPattern)) {
      if (!en.has(match[1])) {
        problems.push(`${path.relative(repoRoot, file)}: key "${match[1]}" is not in en.json`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`i18n:check found ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`i18n:check ok (${en.size} keys, ${locales.length} locale(s))`);
