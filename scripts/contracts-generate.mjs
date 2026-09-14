// Regenerates packages/contracts/src/bindings.ts from the Rust command/event surface.
// CI runs this and fails on `git diff` so the committed bindings never drift.
import path from 'node:path';

import { ensureFrontendDist, repoRoot, run } from './lib.mjs';

const manifest = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');
const out = path.join(repoRoot, 'packages', 'contracts', 'src', 'bindings.ts');

ensureFrontendDist();
run('cargo', [
  'run',
  '--quiet',
  '--manifest-path',
  manifest,
  '--bin',
  'muna',
  '--',
  '--export-bindings',
  out,
]);
