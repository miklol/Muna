import i18next, { type i18n, type TFunction } from 'i18next';

import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ptBR from './locales/pt-BR.json';
import { PSEUDO_RTL_LOCALE, SUPPORTED_LOCALES, pseudoRtlMessage } from './locales';

export {
  isLanguageSetting,
  isSupportedLocale,
  type LanguageSetting,
  localeDisplayName,
  type LocaleStatus,
  localeStatus,
  PSEUDO_RTL_LOCALE,
  pseudoRtlMessage,
  resolveCatalogLocale,
  resolveFormatLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
  SYSTEM_LANGUAGE,
} from './locales';

export const defaultNS = 'translation';
export const fallbackLng = 'en';

/**
 * The `t` of `useTranslation()`, for helpers that take it as a parameter. Never derive it with
 * `ReturnType<typeof useTranslation>['t']`: that erases the hook's `KPrefix` type parameter to
 * its constraint — every key in the catalog — and each call through the alias then costs
 * i18next's key parser O(keys²) instantiations, which trips TS2589 past a few hundred messages.
 * `TFunction`'s defaults are the default namespace and no key prefix, which is the hook's `t`.
 */
export type Translate = TFunction;

/** The instance `createI18n` returns and `useTranslation().i18n` hands back. */
export type I18nInstance = i18n;

type Messages = typeof en;

type DottedKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DottedKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every message key in the English catalog, e.g. `settings.general.title`. */
export type MessageKey = DottedKeys<Messages>;

/** The message under a dotted key, with its interpolation placeholders. */
type Leaf<T, K extends string> = K extends `${infer Head}.${infer Rest}`
  ? Head extends keyof T
    ? Leaf<T[Head], Rest>
    : never
  : K extends keyof T
    ? T[K]
    : never;

/**
 * The catalog as i18next receives it: one level deep, keyed by the dotted paths. The files
 * stay nested for the people who edit them; flattening them here (and telling i18next there is
 * no key separator) keeps i18next's key types linear in the number of messages — its recursive
 * walk over a nested catalog exceeds TypeScript's instantiation budget past a few hundred
 * messages, and the catalog is well past that.
 */
export type FlatMessages = { readonly [K in MessageKey]: Leaf<Messages, K> };

interface Nested {
  readonly [key: string]: string | Nested;
}

/** Keys that are notes for people, not messages: `_review` under every drafted section. */
const isNote = (key: string): boolean => key.startsWith('_');

const flatten = (
  value: Nested,
  prefix: string,
  into: Record<string, string>,
  map: (text: string) => string,
): void => {
  for (const [key, child] of Object.entries(value)) {
    if (isNote(key)) continue;
    const path = `${prefix}${key}`;
    if (typeof child === 'string') {
      into[path] = map(child);
    } else {
      flatten(child, `${path}.`, into, map);
    }
  }
};

const identity = (text: string): string => text;

const flatMessages = (messages: Nested, map = identity): FlatMessages => {
  const flat: Record<string, string> = {};
  flatten(messages, '', flat, map);
  // Every dotted key of the nested catalog is present by construction (`i18n:check` holds the
  // other files to the English key set).
  return flat as FlatMessages;
};

export const resources = {
  en: { [defaultNS]: flatMessages(en) },
  de: { [defaultNS]: flatMessages(de) },
  fr: { [defaultNS]: flatMessages(fr) },
  es: { [defaultNS]: flatMessages(es) },
  'pt-BR': { [defaultNS]: flatMessages(ptBR) },
  [PSEUDO_RTL_LOCALE]: { [defaultNS]: flatMessages(en, pseudoRtlMessage) },
} as const;

export interface CreateI18nOptions {
  /** A catalog tag (see `resolveCatalogLocale`); anything else falls back to English. */
  lng?: string;
}

/**
 * Creates an initialised i18next instance. Initialisation is synchronous because all catalogs
 * are bundled, and so is `changeLanguage`; callers pass the instance to `react-i18next`'s
 * `I18nextProvider`. `supportedLngs` keeps `language` a real catalog tag: `de-AT` becomes `de`,
 * `pt-PT` becomes `pt-BR`, anything unknown becomes English.
 */
export const createI18n = ({ lng = fallbackLng }: CreateI18nOptions = {}): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng,
    supportedLngs: [...SUPPORTED_LOCALES, PSEUDO_RTL_LOCALE],
    defaultNS,
    resources,
    keySeparator: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return instance;
};

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: (typeof resources)['en'];
    keySeparator: false;
  }
}
