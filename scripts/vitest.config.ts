import { defineConfig } from 'vitest/config';

// Release tooling (scripts/**/*.mjs) is plain Node; these tests cover the pure helpers —
// version arithmetic, template rendering, minisign verification, SBOM graph building — so a
// broken release script fails `pnpm -w test` instead of the release run.
export default defineConfig({
  test: {
    name: 'scripts',
    environment: 'node',
    include: ['**/*.test.mjs'],
  },
});
