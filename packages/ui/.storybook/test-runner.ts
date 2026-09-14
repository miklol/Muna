import type { TestRunnerConfig } from '@storybook/test-runner';
import { checkA11y, injectAxe } from 'axe-playwright';

// Runs axe against every story (docs/11-ci-cd.md#quality-gates: zero serious/critical
// violations). Stories may opt out of individual rules through `parameters.a11y.config`.
const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page) {
    await checkA11y(page, '#storybook-root', {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  },
};

export default config;
