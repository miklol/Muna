// Local parity with the `app` job in .github/workflows/ci.yml (Windows only).
import { checkCargoLock } from './check-cargo-lock.mjs';
import { run } from './lib.mjs';

checkCargoLock();
// tauri hands what follows `--` to `cargo build`, so this builds exactly Cargo.lock.
run('pnpm', [
  '--filter',
  '@muna/desktop',
  'tauri',
  'build',
  '--debug',
  '--no-bundle',
  '--',
  '--locked',
]);
run('pnpm', ['-w', 'bundle:check']);
run('pnpm', ['-w', 'e2e']);
run('pnpm', ['-w', 'perf:smoke', '--', '--out', 'perf-smoke.json', '--markdown', 'perf-smoke.md']);
console.log('ci:app ok');
