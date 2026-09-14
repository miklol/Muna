// Local parity with the `app` job in .github/workflows/ci.yml (Windows only).
import { run } from './lib.mjs';

run('pnpm', ['--filter', '@muna/desktop', 'tauri', 'build', '--debug', '--no-bundle']);
run('pnpm', ['-w', 'bundle:check']);
run('pnpm', ['-w', 'e2e']);
run('pnpm', ['-w', 'perf:smoke', '--', '--out', 'perf-smoke.json', '--markdown', 'perf-smoke.md']);
console.log('ci:app ok');
