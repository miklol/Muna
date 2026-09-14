// Performance harness entry point (docs/09-testing-qa.md "Performance", PRD budgets).
// The measurements (startup, idle CPU, RSS, fps) land with M1-E3 together with the notch shell.
// Until then this writes a well-formed report that says so, so the `app` job can post it.
//   node scripts/perf/index.mjs --smoke|--full [--out file.json] [--markdown file.md]
import { writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseArgs, repoRoot } from '../lib.mjs';

const { flags, options } = parseArgs();
const mode = flags.has('full') ? 'full' : 'smoke';

const budgets = {
  startupMs: { max: 800, unit: 'ms', description: 'Cold start to first strip paint' },
  idleCpuPercent: { max: 0.3, unit: '%', description: 'Idle CPU (5 min average)' },
  rssMb: { max: 120, unit: 'MB', description: 'Resident set size after 5 min idle' },
  morphFps: { min: 58, unit: 'fps', description: 'Strip ↔ panel morph frame rate' },
};

const report = {
  mode,
  status: 'not-implemented',
  milestone: 'M1-E3',
  generatedAt: new Date().toISOString(),
  budgets,
  measurements: [],
};

const markdown = [
  `### Perf ${mode} — not measured yet`,
  '',
  'The performance harness lands with **M1-E3** (notch shell). Budgets that will be enforced:',
  '',
  '| Metric | Budget |',
  '| --- | --- |',
  ...Object.entries(budgets).map(
    ([, b]) => `| ${b.description} | ${'max' in b ? `≤ ${b.max}` : `≥ ${b.min}`} ${b.unit} |`,
  ),
  '',
  '<!-- muna-perf-report -->',
  '',
].join('\n');

const out = options.get('out');
const md = options.get('markdown');
if (out) writeFileSync(path.resolve(repoRoot, out), `${JSON.stringify(report, null, 2)}\n`);
if (md) writeFileSync(path.resolve(repoRoot, md), markdown);

console.log(markdown);
if (out) console.log(`wrote ${out}`);
if (md) console.log(`wrote ${md}`);
