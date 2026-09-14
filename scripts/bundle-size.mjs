// Bundle size budgets (docs/02-prd.md, docs/11-ci-cd.md quality gates).
//   - web bundle (apps/desktop/dist JS, gzipped): ≤ 1.2 MB
//   - muna.exe (release): ≤ 12 MB — the debug exe produced by the `app` job is reported only
//   - MSIX: ≤ 20 MB when one exists
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { fileSize, formatBytes, repoRoot } from './lib.mjs';

const budgets = {
  webGzipBytes: 1_200_000,
  releaseExeBytes: 12 * 1024 * 1024,
  msixBytes: 20 * 1024 * 1024,
};

const dist = path.join(repoRoot, 'apps', 'desktop', 'dist');
const target = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'target');
const failures = [];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

if (!existsSync(dist)) {
  console.error('apps/desktop/dist is missing; run `pnpm --filter @muna/desktop build` first');
  process.exit(1);
}

let webGzip = 0;
for (const file of walk(dist)) {
  if (/\.(js|mjs|css)$/.test(file)) webGzip += gzipSync(readFileSync(file)).length;
}
console.log(
  `web bundle (gzip js+css): ${formatBytes(webGzip)} / ${formatBytes(budgets.webGzipBytes)}`,
);
if (webGzip > budgets.webGzipBytes) failures.push('web bundle exceeds budget');

const releaseExe = fileSize(path.join(target, 'release', 'muna.exe'));
const debugExe = fileSize(path.join(target, 'debug', 'muna.exe'));
if (releaseExe !== null) {
  console.log(
    `muna.exe (release): ${formatBytes(releaseExe)} / ${formatBytes(budgets.releaseExeBytes)}`,
  );
  if (releaseExe > budgets.releaseExeBytes) failures.push('release exe exceeds budget');
} else if (debugExe !== null) {
  console.log(
    `muna.exe (debug): ${formatBytes(debugExe)} (informational; budget applies to release builds)`,
  );
} else {
  console.log('muna.exe: not built; skipping exe budget');
}

const msixDir = path.join(target, 'release', 'bundle', 'msix');
if (existsSync(msixDir)) {
  for (const file of walk(msixDir)) {
    if (file.endsWith('.msix')) {
      const size = fileSize(file);
      console.log(
        `${path.basename(file)}: ${formatBytes(size)} / ${formatBytes(budgets.msixBytes)}`,
      );
      if (size > budgets.msixBytes) failures.push(`${path.basename(file)} exceeds budget`);
    }
  }
}

if (failures.length > 0) {
  console.error(`bundle:check failed: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('bundle:check ok');
