// npm licence allowlist (docs/11-ci-cd.md "Dependency policy"). Cargo is covered by
// cargo-deny (deny.toml at the repo root). Runs against the production dependency tree of
// each shipped app; workspace packages are private and excluded.
import path from 'node:path';

import { repoRoot, run } from './lib.mjs';

export const allowedLicenses = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MPL-2.0',
  'Zlib',
  'Unicode-3.0',
  'CC0-1.0',
  'OFL-1.1',
  // SPDX expressions that resolve to entries above but are not normalised by the checker.
  '0BSD',
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '(Apache-2.0 OR MPL-1.1)',
  'MIT OR Apache-2.0',
  'BlueOak-1.0.0',
];

for (const app of ['apps/desktop', 'apps/site']) {
  run('pnpm', [
    'exec',
    'license-checker-rseidelsohn',
    '--start',
    path.join(repoRoot, app),
    '--production',
    '--excludePrivatePackages',
    '--onlyAllow',
    allowedLicenses.join(';'),
    '--summary',
  ]);
}
console.log('licenses:check ok');
