import type { Settings } from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import type { MessageKey } from '@muna/i18n';
import { NotchSurface, Text } from '@muna/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { fn } from 'storybook/test';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { i18n } from '../lib/i18n';
import { createQueryClient } from '../lib/query-client';
import { cacheSettings, useSettings } from '../lib/settings';
import { SettingsEditorProvider } from '../settings/settings-editor';
import { Panel } from '../shell/panel';

export interface StoryProvidersProps {
  /** The document the query cache starts with; what `installStoryIpc` returned. */
  settings?: Settings;
  children: ReactNode;
}

/**
 * The providers both app windows mount (`AppProviders` minus the Tauri subscriptions): the
 * i18n instance with the English catalogue and a fresh query cache primed with the story's
 * settings so `useSettings()` answers synchronously on the first render.
 */
export function StoryProviders({ settings, children }: StoryProvidersProps) {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    cacheSettings(client, settings ?? defaultSettings());
    return client;
  });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
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
