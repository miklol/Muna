// Message catalog checks (docs/11-ci-cd.md quality gates, docs/05 UX copy rules):
//   1. every locale has exactly the keys of en.json (no missing, no extra); a plural key
//      (`key_one`, `key_other`, …) counts by its base, since forms differ per language, and
//      every locale must carry the `_other` form i18next falls back to;
//   2. no empty strings;
//   3. no exclamation marks in English copy;
//   4. every `t('key')` literal used by the apps exists in en.json, plural bases included.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { repoRoot } from './lib.mjs';

const localesDir = path.join(repoRoot, 'packages', 'i18n', 'src', 'locales');
const sourceDirs = [
  path.join(repoRoot, 'apps', 'desktop', 'src'),
  path.join(repoRoot, 'packages', 'ui', 'src'),
];

/** i18next's CLDR plural suffixes (`t('key', { count })` resolves to `key_<form>`). */
const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;

const pluralBase = (key) => {
  const match = PLURAL_SUFFIX.exec(key);
  return match === null ? null : key.slice(0, -match[0].length);
};

/** The keys a catalog answers: plain keys plus the base of every plural family. */
function catalogKeys(flat) {
  const keys = new Set();
  for (const key of flat.keys()) keys.add(pluralBase(key) ?? key);
  return keys;
}

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

const enKeys = catalogKeys(en);
for (const base of enKeys) {
  if (!en.has(base) && !en.has(`${base}_other`)) {
    problems.push(`en.json: plural key ${base} has no _other form`);
  }
}

for (const file of locales) {
  if (file === 'en.json') continue;
  const other = flatten(JSON.parse(readFileSync(path.join(localesDir, file), 'utf8')));
  const otherKeys = catalogKeys(other);
  for (const key of enKeys) if (!otherKeys.has(key)) problems.push(`${file}: missing ${key}`);
  for (const key of otherKeys) if (!enKeys.has(key)) problems.push(`${file}: unknown key ${key}`);
  for (const key of enKeys) {
    if (en.has(`${key}_other`) && !other.has(key) && !other.has(`${key}_other`)) {
      problems.push(`${file}: plural key ${key} has no _other form`);
    }
  }
  for (const [key, text] of other) {
    if (text.trim() === '') problems.push(`${file}: ${key} is empty`);
  }
}

const keyPattern = /\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
for (const dir of sourceDirs) {
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(keyPattern)) {
      if (!enKeys.has(match[1])) {
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
