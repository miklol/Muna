import type { Settings } from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import { type MessageKey, SYSTEM_LANGUAGE } from '@muna/i18n';
import { NotchSurface, Text } from '@muna/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { fn } from 'storybook/test';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { i18n } from '../lib/i18n';
import { applyDocumentLocale, LocaleProvider, resolveLocale } from '../lib/locale';
import { createQueryClient } from '../lib/query-client';
import { cacheSettings, useSettings } from '../lib/settings';
import { SettingsEditorProvider } from '../settings/settings-editor';
import { Panel } from '../shell/panel';

export interface StoryProvidersProps {
  /** The document the query cache starts with; what `installStoryIpc` returned. */
  settings?: Settings;
  /** The Language toolbar's catalog tag (`de`, `ar-XB`); English unless told otherwise. */
  language?: string;
  children: ReactNode;
}

interface StoryLanguageProps {
  toolbar: string;
  children: ReactNode;
}

/**
 * Stands in for the language half of `SettingsBridge`, which stories do not mount. The
 * toolbar's language holds until the story's document chooses one — as a user does on the
 * General pane — and then the story follows the document live, exactly like the window.
 */
function StoryLanguage({ toolbar, children }: StoryLanguageProps) {
  const chosen = useSettings()?.general.language ?? SYSTEM_LANGUAGE;
  const { catalog, format } = resolveLocale(
    chosen === SYSTEM_LANGUAGE ? toolbar : chosen,
    undefined,
  );
  useEffect(() => {
    if (i18n.language !== catalog) {
      void i18n.changeLanguage(catalog);
    }
    applyDocumentLocale(i18n);
  }, [catalog]);
  return <LocaleProvider value={format}>{children}</LocaleProvider>;
}

/**
 * The providers both app windows mount (`AppProviders` minus the Tauri subscriptions): the
 * i18n instance speaking whatever the toolbar chose, the matching `Intl` tag and a fresh query
 * cache primed with the story's settings so `useSettings()` answers synchronously on the first
 * render.
 */
export function StoryProviders({ settings, language = 'en', children }: StoryProvidersProps) {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    cacheSettings(client, settings ?? defaultSettings());
    return client;
  });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <StoryLanguage toolbar={language}>{children}</StoryLanguage>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

export interface PanelFrameProps {
  /** The panel header; a module's `titleKey` resolved by the story. */
  title: string;
  /** Panel size in CSS pixels; the shell's expanded island by default. */
  width?: number;
  height?: number;
  children: ReactNode;
}

/**
 * A module body as the notch shows it: the black-glass island at its expanded size with the
 * shell's `Panel` header (pin and collapse are recorded by Storybook's `fn()`, nothing moves).
 */
export function PanelFrame({ title, width = 420, height = 320, children }: PanelFrameProps) {
  return (
    <NotchSurface shape="island" state="expanded" style={{ width, height }}>
      <Panel title={title} pinned={false} onPinChange={fn()} onCollapse={fn()}>
        {children}
      </Panel>
    </NotchSurface>
  );
}

export interface SettingsPaneFrameProps {
  /** The pane heading, as the settings window's tab panel renders it. */
  titleKey: MessageKey;
  children: ReactNode;
}

/**
 * A settings pane as the settings window lays it out: the column width, the pane title and the
 * shared editor bound to the cached document, so `update_settings` round-trips through the
 * story's fake IPC like it does through Rust.
 */
export function SettingsPaneFrame({ titleKey, children }: SettingsPaneFrameProps) {
  const { t } = useTranslation();
  const settings = useSettings() ?? defaultSettings();
  return (
    <SettingsEditorProvider settings={settings}>
      <main className="mx-auto flex max-w-160 flex-col gap-6 p-8">
        <Text as="h1" variant="title2">
          {t(titleKey)}
        </Text>
        {children}
      </main>
    </SettingsEditorProvider>
  );
}
