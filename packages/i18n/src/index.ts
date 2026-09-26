import i18next, { type i18n, type TFunction } from 'i18next';

import en from './locales/en.json';

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

const flatten = (value: Nested, prefix: string, into: Record<string, string>): void => {
  for (const [key, child] of Object.entries(value)) {
    const path = `${prefix}${key}`;
    if (typeof child === 'string') {
      into[path] = child;
    } else {
      flatten(child, `${path}.`, into);
    }
  }
};

const flatMessages = (messages: Nested): FlatMessages => {
  const flat: Record<string, string> = {};
  flatten(messages, '', flat);
  // Every dotted key of the nested catalog is present by construction.
  return flat as FlatMessages;
};

export const resources = {
  en: { [defaultNS]: flatMessages(en) },
} as const;

export interface CreateI18nOptions {
  /** BCP-47 tag; unknown locales fall back to English. */
  lng?: string;
}

/**
 * Creates an initialised i18next instance. Initialisation is synchronous because all catalogs
 * are bundled; callers pass the instance to `react-i18next`'s `I18nextProvider`.
 */
export const createI18n = ({ lng = fallbackLng }: CreateI18nOptions = {}): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    lng,
    fallbackLng,
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
