import type { Settings } from '@muna/contracts';
import { localeDisplayName, PSEUDO_RTL_LOCALE, SUPPORTED_LOCALES } from '@muna/i18n';
import type { Decorator, Loader, Preview } from '@storybook/react-vite';
import '@muna/ui/fonts.css';
import { munaPreview } from '@muna/ui/storybook';

import '../src/styles.css';
import { i18n } from '../src/lib/i18n';
import { applyDocumentLocale, resolveLocale } from '../src/lib/locale';
import { StoryProviders } from '../src/storybook/frames';
import { installStoryIpc, type MunaStoryParameters } from '../src/storybook/ipc';

interface Loaded {
  settings: Settings;
  /** The Language toolbar's catalog tag. */
  language: string;
}

const STORY_LOCALES = [...SUPPORTED_LOCALES, PSEUDO_RTL_LOCALE] as const;

const storyLanguage = (value: unknown): string =>
  typeof value === 'string' && STORY_LOCALES.some((tag) => tag === value) ? value : 'en';

// Runs before the story renders (child effects fire before a decorator's would), so the first
// `commands.*` call a component makes on mount already reaches the story's fake IPC, and the
// catalog is the toolbar's language before the first `t()`.
const ipcLoader: Loader = (context): Loaded => {
  const parameters = context.parameters as MunaStoryParameters;
  document.body.dataset.window = parameters.window ?? 'notch';
  const language = storyLanguage(context.globals.locale);
  const { catalog } = resolveLocale(language, undefined);
  if (i18n.language !== catalog) {
    void i18n.changeLanguage(catalog);
  }
  applyDocumentLocale(i18n);
  return { settings: installStoryIpc(parameters), language };
};

// Keyed by story so every story starts from its own query cache and settings document.
const withStoryProviders: Decorator = (Story, context) => {
  const loaded = context.loaded as Partial<Loaded>;
  return (
    <StoryProviders
      key={context.id}
      {...(loaded.settings && { settings: loaded.settings })}
      {...(loaded.language && { language: loaded.language })}
    >
      <Story />
    </StoryProviders>
  );
};

// Innermost, so a right-to-left catalog flips the story even though the shared `direction`
// wrapper outside it says LTR; the Direction toolbar still works for an LTR catalog.
const withCatalogDirection: Decorator = (Story) =>
  i18n.dir() === 'rtl' ? (
    <div dir="rtl">
      <Story />
    </div>
  ) : (
    <Story />
  );

const preview: Preview = {
  ...munaPreview,
  globalTypes: {
    ...munaPreview.globalTypes,
    locale: {
      description: 'Settings → General → Language',
      toolbar: {
        title: 'Language',
        icon: 'globe',
        items: STORY_LOCALES.map((tag) => ({ value: tag, title: localeDisplayName(tag) })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { ...munaPreview.initialGlobals, locale: 'en' },
  loaders: [ipcLoader],
  decorators: [withCatalogDirection, ...munaPreview.decorators, withStoryProviders],
};

export default preview;
