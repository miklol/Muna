import { getStoryContext, type TestRunnerConfig } from '@storybook/test-runner';
import { checkA11y, configureAxe, injectAxe } from 'axe-playwright';

interface AxeRule {
  id: string;
  enabled?: boolean;
}

interface A11yParameters {
  disable?: boolean;
  config?: { rules?: AxeRule[] };
}

// Runs axe against every story (docs/11-ci-cd.md#quality-gates: zero serious/critical
// violations). Stories may opt out of individual rules through `parameters.a11y.config.rules`
// (the same shape the a11y addon reads), each opt-out with a comment saying why.
const config: TestRunnerConfig = {
  async preVisit(page) {
    await injectAxe(page);
  },
  async postVisit(page, context) {
    const storyContext = await getStoryContext(page, context);
    const a11y = storyContext.parameters.a11y as A11yParameters | undefined;
    if (a11y?.disable === true) return;
    await configureAxe(page, { rules: a11y?.config?.rules ?? [] });
    await checkA11y(page, '#storybook-root', {
      detailedReport: true,
      detailedReportOptions: { html: true },
    });
  },
};

export default config;
