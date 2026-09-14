import { defineConfig } from '@playwright/test';

// Shell scenario suite S1–S14 (docs/09-testing-qa.md) lands with M1-E1. The config exists so
// `pnpm --filter @muna/desktop e2e` has a stable entry point and CI can upload the report.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'retain-on-failure',
  },
});
