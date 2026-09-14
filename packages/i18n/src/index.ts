import i18next, { type i18n } from 'i18next';

import en from './locales/en.json';

export const defaultNS = 'translation';
export const fallbackLng = 'en';

export const resources = {
  en: { [defaultNS]: en },
} as const;

type Messages = typeof en;

type DottedKeys<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : DottedKeys<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** Every message key in the English catalog, e.g. `settings.general.title`. */
export type MessageKey = DottedKeys<Messages>;

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
  }
}
