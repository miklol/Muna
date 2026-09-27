// Message catalog checks (docs/11-ci-cd.md quality gates, docs/05 UX copy rules,
// docs/localization.md):
//   1. every locale has exactly the keys of en.json (no missing, no extra); a plural key
//      (`key_one`, `key_other`, …) counts by its base, since forms differ per language, and
//      every locale must carry the `_other` form i18next falls back to;
//   2. no empty strings;
//   3. no exclamation marks in English copy;
//   4. every `t('key')` literal used by the apps exists in en.json, plural bases included;
//   5. a translation keeps the English message's `{{placeholders}}`, no more and no fewer;
//   6. a translation of two words or more is not the English message itself — that is a
//      copied source string, not a translation (single words may be names or cognates, and
//      the product names in `SAME_EVERYWHERE` read the same in every language);
//   7. every top-level section of a non-English catalog carries a `_review` note saying who
//      reviewed it, or that nobody has yet; English, the source, carries none. Keys starting
//      with `_` are notes for translators and never messages (`@muna/i18n` strips them).
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

/** `{{name}}`, `{{name, format}}` — i18next's interpolation, not ICU. */
const PLACEHOLDER = /\{\{\s*([^,}\s]+)[^}]*\}\}/g;

/** A copied English message is one this long or longer; a single word may be a name or a cognate. */
const COPIED_MIN_WORDS = 2;

/** Product names that read the same in every language; add a key here only for those. */
const SAME_EVERYWHERE = new Set(['aiCoding.agent.claude', 'aiCoding.agent.copilot']);

const isNote = (key) => key.startsWith('_');

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

/** Flattens messages to `a.b.c → text`, leaving `_`-prefixed notes out. */
function flatten(value, prefix = '') {
  const out = new Map();
  for (const [key, child] of Object.entries(value)) {
    if (isNote(key)) continue;
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

/** `_`-prefixed notes anywhere in the tree, as `a.b._review → text`. */
function notes(value, prefix = '') {
  const out = new Map();
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (isNote(key)) {
      out.set(full, child);
    } else if (child && typeof child === 'object') {
      for (const [k, v] of notes(child, full)) out.set(k, v);
    }
  }
  return out;
}

const placeholders = (text) =>
  [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort();

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

const wordCount = (text) =>
  text
    .replace(PLACEHOLDER, ' ')
    .split(/\s+/)
    .filter((word) => /\p{L}/u.test(word)).length;

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
const summary = [];
const locales = readdirSync(localesDir).filter((f) => f.endsWith('.json'));
const enTree = JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf8'));
const en = flatten(enTree);

for (const [key, text] of en) {
  if (text.trim() === '') problems.push(`en.json: ${key} is empty`);
  if (text.includes('!')) problems.push(`en.json: ${key} contains an exclamation mark`);
}
for (const key of notes(enTree).keys()) {
  problems.push(`en.json: ${key} — the source catalog carries no translator notes`);
}

const enKeys = catalogKeys(en);
for (const base of enKeys) {
  if (!en.has(base) && !en.has(`${base}_other`)) {
    problems.push(`en.json: plural key ${base} has no _other form`);
  }
}

for (const file of locales) {
  if (file === 'en.json') continue;
  const tree = JSON.parse(readFileSync(path.join(localesDir, file), 'utf8'));
  const other = flatten(tree);
  const otherKeys = catalogKeys(other);
  for (const key of enKeys) if (!otherKeys.has(key)) problems.push(`${file}: missing ${key}`);
  for (const key of otherKeys) if (!enKeys.has(key)) problems.push(`${file}: unknown key ${key}`);
  for (const key of enKeys) {
    if (en.has(`${key}_other`) && !other.has(key) && !other.has(`${key}_other`)) {
      problems.push(`${file}: plural key ${key} has no _other form`);
    }
  }

  let copied = 0;
  for (const [key, text] of other) {
    if (text.trim() === '') {
      problems.push(`${file}: ${key} is empty`);
      continue;
    }
    // A plural form the source lacks (`few`, `many`) is compared with the source's `_other`.
    const source = en.get(key) ?? en.get(`${pluralBase(key) ?? key}_other`);
    if (source === undefined) continue;
    if (!sameList(placeholders(source), placeholders(text))) {
      problems.push(
        `${file}: ${key} placeholders {{${placeholders(text).join(', ')}}} differ from English {{${placeholders(source).join(', ')}}}`,
      );
    }
    if (text === source && wordCount(text) >= COPIED_MIN_WORDS && !SAME_EVERYWHERE.has(key)) {
      copied += 1;
      problems.push(`${file}: ${key} is the English message, not a translation`);
    }
  }

  for (const [section, child] of Object.entries(tree)) {
    if (isNote(section) || typeof child !== 'object' || child === null) continue;
    const review = child._review;
    if (typeof review !== 'string' || review.trim() === '') {
      problems.push(`${file}: section "${section}" has no _review note`);
    }
  }
  for (const [key, text] of notes(tree)) {
    if (typeof text !== 'string' || text.trim() === '') {
      problems.push(`${file}: note ${key} must be a non-empty string`);
    }
  }
  summary.push(`${file}: ${other.size} messages, ${copied} still English`);
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

for (const line of summary) console.log(line);
if (problems.length > 0) {
  console.error(`i18n:check found ${problems.length} problem(s):`);
  const shown = problems.slice(0, 200);
  for (const problem of shown) console.error(`  - ${problem}`);
  if (shown.length < problems.length) {
    console.error(`  … and ${problems.length - shown.length} more`);
  }
  process.exit(1);
}
console.log(`i18n:check ok (${en.size} keys, ${locales.length} locale(s))`);
