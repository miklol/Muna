// Local parity with the `deps` job in .github/workflows/ci.yml.
// Needs cargo-deny (`cargo install cargo-deny --locked`).
import path from 'node:path';

import { repoRoot, run } from './lib.mjs';

const manifest = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');

run('cargo', ['deny', '--manifest-path', manifest, '--all-features', 'check']);
run('pnpm', ['audit', '--prod', '--audit-level', 'high']);
run('pnpm', ['-w', 'licenses:check']);
console.log('ci:deps ok');
