import type { Settings } from '@muna/contracts';
import type { Decorator, Loader, Preview } from '@storybook/react-vite';
import '@muna/ui/fonts.css';
import { munaPreview } from '@muna/ui/storybook';

import '../src/styles.css';
import { StoryProviders } from '../src/storybook/frames';
import { installStoryIpc, type MunaStoryParameters } from '../src/storybook/ipc';

interface Loaded {
  settings: Settings;
}

// Runs before the story renders (child effects fire before a decorator's would), so the first
// `commands.*` call a component makes on mount already reaches the story's fake IPC.
const ipcLoader: Loader = (context): Loaded => {
  const parameters = context.parameters as MunaStoryParameters;
  document.body.dataset.window = parameters.window ?? 'notch';
  return { settings: installStoryIpc(parameters) };
};

// Keyed by story so every story starts from its own query cache and settings document.
const withStoryProviders: Decorator = (Story, context) => {
  const loaded = context.loaded as Partial<Loaded>;
  return (
    <StoryProviders key={context.id} {...(loaded.settings && { settings: loaded.settings })}>
      <Story />
    </StoryProviders>
  );
};

const preview: Preview = {
  ...munaPreview,
  loaders: [ipcLoader],
  decorators: [...munaPreview.decorators, withStoryProviders],
};

export default preview;
