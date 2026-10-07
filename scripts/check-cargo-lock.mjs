// Fails when apps/desktop/src-tauri/Cargo.lock no longer satisfies the Cargo.toml requirements,
// i.e. when cargo would re-resolve it before building. CI runs this before any cargo step (and
// passes `--locked` to every build), so a lockfile-only bump fails here instead of going green
// on the versions it meant to replace (#90). Local parity: `ci:rust` and `ci:app` call it too.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { isMain, repoRoot } from './lib.mjs';

const manifest = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
const lockfile = 'apps/desktop/src-tauri/Cargo.lock';

const hint =
  'Cargo.lock does not match the Cargo.toml requirements, so cargo would re-resolve it and ' +
  'build other versions than the lockfile names. If a dependency bump changed only ' +
  'Cargo.lock, raise the requirement in the Cargo.toml that declares the crate ' +
  '(docs/11-ci-cd.md, runbook "Dependabot PR fails CI").';

export function checkCargoLock() {
  const args = ['metadata', '--locked', '--format-version', '1', '--manifest-path', manifest];
  console.log(`\n$ cargo ${args.join(' ')}`);
  const result = spawnSync('cargo', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) {
    console.error(`failed to start cargo: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status === 0) {
    console.log(`${lockfile} matches the manifests`);
    return;
  }
  process.stderr.write(result.stderr);
  // "cannot update the lock file … because --locked was passed" (older cargo: "needs to be updated
  // but --locked was passed"); anything else, e.g. a network error, is not a stale lockfile.
  if (result.stderr.includes('--locked was passed')) {
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(`::error file=${lockfile},title=Cargo.lock is out of date::${hint}`);
    } else {
      console.error(`\n${hint}`);
    }
  }
  process.exit(result.status ?? 1);
}

if (isMain(import.meta.url)) {
  checkCargoLock();
}
