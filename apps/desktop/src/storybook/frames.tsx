import type { Settings } from '@muna/contracts';
import { defaultSettings } from '@muna/contracts';
import { type MessageKey, SYSTEM_LANGUAGE } from '@muna/i18n';
import { NotchSurface, Text } from '@muna/ui/primitives';
import { QueryClientProvider } from '@tanstack/react-query';
import { fn } from 'storybook/test';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { i18n } from '../lib/i18n';
import { applyDocumentLocale, LocaleProvider, resolveLocale } from '../lib/locale';
import { createQueryClient } from '../lib/query-client';
import { cacheSettings, useSettings } from '../lib/settings';
import { SettingsEditorProvider } from '../settings/settings-editor';
import { Panel } from '../shell/panel';
import { shellSizes } from '../shell/shell-geometry';

// The settings window's own stylesheet (swatches, key caps): `settings-app.tsx` imports it in
// the app, and pane stories render without that shell.
import '../settings/settings.css';

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
  /**
   * Panel size in CSS pixels. The defaults are what the shell lays out on a 1024 px-wide work
   * area — `min(1000, monitor − 80)` wide, so 944 here, and the content's own height clamped to
   * 190–360 (`shell-geometry`) — so a story shows the layout the app shows, and content the
   * shell would clip is clipped here too. Pass `width` for a narrower work area.
   */
  width?: number;
  height?: number;
  children: ReactNode;
}

/** The work area the frames stand in for: the 1024 px-wide viewport the Storybook CI runs at. */
const STORY_WORK_AREA_WIDTH = 1024;

const clampPanelHeight = (natural: number): number =>
  Math.min(shellSizes.panelMaxHeight, Math.max(shellSizes.panelMinHeight, natural));

/**
 * A module body as the notch shows it: the black-glass island at the shell's panel size with
 * the shell's `Panel` header (pin and collapse are recorded by Storybook's `fn()`, nothing
 * moves). Like `NotchWindow`, it measures the panel's natural height and sizes the surface to
 * it, because the surface's shape is positioned and takes no height from its content.
 */
export function PanelFrame({
  title,
  width = Math.min(shellSizes.panelWidth, STORY_WORK_AREA_WIDTH - 80),
  height,
  children,
}: PanelFrameProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<number | null>(null);
  useLayoutEffect(() => {
    const node = panelRef.current;
    if (node === null || height !== undefined) {
      return;
    }
    if (typeof ResizeObserver === 'undefined') {
      setNatural(node.offsetHeight);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.borderBoxSize[0];
      setNatural(box !== undefined ? box.blockSize : node.offsetHeight);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [height]);
  const resolved = height ?? clampPanelHeight(natural ?? shellSizes.panelMinHeight);
  return (
    <NotchSurface shape="island" state="expanded" style={{ width, height: resolved }}>
      <div ref={panelRef} className="w-full">
        <Panel title={title} pinned={false} onPinChange={fn()} onCollapse={fn()}>
          {children}
        </Panel>
      </div>
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
