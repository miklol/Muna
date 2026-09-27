import { TRANSLATION_AUTO } from '@muna/contracts';

/**
 * The languages the panel offers, as BCP-47 tags (docs/modules/translation.md). A closed list
 * on purpose: every entry has a name `Intl.DisplayNames` knows in every UI locale, and the
 * provider is told the language's English name, which `language_name` in Rust maps from the
 * same tags. Ordered by how often they are asked for, then by region.
 */
export const LANGUAGES: readonly string[] = [
  'en',
  'es',
  'fr',
  'de',
  'it',
  'pt',
  'pt-BR',
  'nl',
  'pl',
  'ru',
  'uk',
  'tr',
  'ar',
  'he',
  'fa',
  'hi',
  'bn',
  'zh-Hans',
  'zh-Hant',
  'ja',
  'ko',
  'vi',
  'th',
  'id',
  'ms',
  'sv',
  'da',
  'nb',
  'fi',
  'cs',
  'el',
  'hu',
  'ro',
  'sw',
  'am',
];

const displayNames = new Map<string, Intl.DisplayNames | null>();

const namesFor = (locale: string): Intl.DisplayNames | null => {
  const cached = displayNames.get(locale);
  if (cached !== undefined) return cached;
  let names: Intl.DisplayNames | null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'language', languageDisplay: 'standard' });
  } catch {
    names = null;
  }
  displayNames.set(locale, names);
  return names;
};

/**
 * The name of `tag` in the UI's `locale` ("Portuguese (Brazil)", "Chinese (Simplified)"), or
 * the tag itself when the runtime has no name for it. `auto` is not a language: callers print
 * their own label for it.
 */
export const languageName = (tag: string, locale: string): string => {
  if (tag === TRANSLATION_AUTO) return tag;
  try {
    return namesFor(locale)?.of(tag) ?? tag;
  } catch {
    return tag;
  }
};

/** `true` when `tag` is one the panel offers (or `auto`). */
export const isKnownLanguage = (tag: string): boolean =>
  tag === TRANSLATION_AUTO || LANGUAGES.includes(tag);

/**
 * The languages whose name or tag contains `query`, case-insensitively; every language when
 * `query` is blank. Names are compared in `locale`, so a French UI finds "allemand".
 */
export const filterLanguages = (query: string, locale: string): readonly string[] => {
  const needle = query.trim().toLocaleLowerCase(locale);
  if (needle === '') return LANGUAGES;
  return LANGUAGES.filter(
    (tag) =>
      languageName(tag, locale).toLocaleLowerCase(locale).includes(needle) ||
      tag.toLowerCase().includes(needle),
  );
};
