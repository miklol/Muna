// Local parity with the `rust` job in .github/workflows/ci.yml.
import path from 'node:path';

import { repoRoot, run } from './lib.mjs';

const manifest = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');

run('pnpm', ['--filter', '@muna/desktop', 'build']);
run('cargo', ['fmt', '--all', '--check', '--manifest-path', manifest]);
run('cargo', [
  'clippy',
  '--manifest-path',
  manifest,
  '--all-targets',
  '--all-features',
  '--',
  '-D',
  'warnings',
]);
run('cargo', ['test', '--manifest-path', manifest, '--all-features']);
run('pnpm', ['-w', 'contracts:generate']);
run('git', ['diff', '--exit-code', '--', 'packages/contracts']);
console.log('ci:rust ok');
