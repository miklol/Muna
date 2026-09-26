import type { StorybookConfig } from '@storybook/react-vite';

// Module states for the desktop app (docs/03-architecture.md: every module ships stories).
// Runs on its own Vite config: the app's two-page build input and dev-server pins are not for
// the story bundle. `pnpm -w storybook:desktop` serves it; `storybook:ci` gates it with axe.
const config: StorybookConfig = {
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  docs: { defaultName: 'Docs' },
};

export default config;
