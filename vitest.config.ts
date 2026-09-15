import { defineConfig } from 'vitest/config';

// Root runner: every workspace package with a vitest.config.ts is a project. `pnpm -w test`
// runs them all; CI adds `--run --coverage` (docs/11-ci-cd.md#required-checks).
export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      'scripts/vitest.config.ts',
    ],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      reportsDirectory: 'coverage',
      include: [
        'packages/ui/src/**',
        'packages/contracts/src/**',
        'packages/i18n/src/**',
        'apps/desktop/src/**',
      ],
      exclude: [
        '**/*.stories.tsx',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/vitest.setup.ts',
        // Generated and entry files: no logic to cover.
        'packages/contracts/src/bindings.ts',
        'apps/desktop/src/main.tsx',
        'apps/desktop/src/settings-main.tsx',
      ],
      // Gate from docs/11-ci-cd.md#quality-gates: design system and modules ≥ 80 % lines.
      thresholds: {
        'packages/ui/src/**': { lines: 80 },
        'apps/desktop/src/modules/**': { lines: 80 },
      },
    },
  },
});
