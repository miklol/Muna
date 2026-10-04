import { commands } from '@muna/contracts';
import {
  type I18nInstance,
  PSEUDO_RTL_LOCALE,
  resolveCatalogLocale,
  resolveFormatLocale,
  SYSTEM_LANGUAGE,
} from '@muna/i18n';
import { queryOptions } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';

/** Static facts about the build and the machine; read once per window, never refreshed. */
export const appInfoQuery = queryOptions({
  queryKey: ['app-info'] as const,
  queryFn: () => commands.appInfo(),
});

/**
 * The tags Windows prefers, most preferred first: the display language and its fallbacks
 * (`navigator.languages`). English outside a browser.
 */
export const systemLanguages = (): readonly string[] => {
  if (typeof navigator === 'undefined') return ['en'];
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
};

export interface ResolvedLocale {
  /** The catalog i18next speaks (`de`, `pt-BR`, the pseudo-locale). */
  readonly catalog: string;
  /** The tag `Intl` formats with (`de-CH` under `system`, else the catalog). */
  readonly format: string;
}

/**
 * Settings → General → Language, resolved (docs/localization.md). `system` — and an unknown
 * value from an older or edited file — follows the Windows display language for the text and
 * the regional format (from Rust) for dates and numbers; a chosen language is used for both.
 */
export const resolveLocale = (
  language: string | undefined,
  regionFormat: string | undefined,
): ResolvedLocale => {
  const setting = language ?? SYSTEM_LANGUAGE;
  const preferred = systemLanguages();
  return {
    catalog: resolveCatalogLocale(setting, preferred),
    format: resolveFormatLocale(setting, regionFormat, preferred),
  };
};

/**
 * Mirrors the language i18next actually speaks onto `<html>`: `lang` for screen readers and
 * hyphenation, `dir` so the layout flips for a right-to-left catalog. Reads the resolved
 * language, not the requested one, so an unsupported right-to-left Windows language showing
 * English keeps English's direction.
 */
export function applyDocumentLocale(i18n: I18nInstance): void {
  const spoken = i18n.resolvedLanguage ?? i18n.language;
  const root = document.documentElement;
  root.lang = spoken === PSEUDO_RTL_LOCALE ? 'en' : spoken;
  root.dir = i18n.dir(spoken);
}

const LocaleContext = createContext<string>(resolveLocale(undefined, undefined).format);

interface LocaleProviderProps {
  /** The `Intl` tag for everything below. */
  value: string;
  children: ReactNode;
}

export function LocaleProvider({ value, children }: LocaleProviderProps) {
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * The tag every `Intl` formatter in the UI takes: dates, numbers, relative times, language
 * names and list conjunctions all follow one choice. Outside a `LocaleProvider` (tests) it is
 * the Windows display language.
 */
export function useLocale(): string {
  return useContext(LocaleContext);
}
