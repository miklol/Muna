/**
 * The catalogs Muna ships and how a language setting resolves to one (docs/localization.md).
 * Pure functions: the desktop app feeds them the setting, the Windows display language
 * (`navigator.languages`) and the regional format Rust read, and applies the answers.
 */

/** Catalogs under `locales/*.json`, English first; each other file is a draft until reviewed. */
export const SUPPORTED_LOCALES = ['en', 'de', 'fr', 'es', 'pt-BR'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * The right-to-left pseudo-locale (spike S3): English with every message wrapped in a
 * right-to-left override, so the text reads mirrored and the layout flips without a real
 * translation. Android's tag for the same idea; never offered to users.
 */
export const PSEUDO_RTL_LOCALE = 'ar-XB';

/** Settings → General → Language: follow Windows, or one catalog. */
export const SYSTEM_LANGUAGE = 'system';

export type LanguageSetting = typeof SYSTEM_LANGUAGE | SupportedLocale;

/** Where a catalog stands: the English source, a machine draft awaiting review, or the smoke. */
export type LocaleStatus = 'source' | 'draft' | 'pseudo';

const DRAFTS: ReadonlySet<string> = new Set<string>(['de', 'fr', 'es', 'pt-BR']);

export const isSupportedLocale = (tag: string): tag is SupportedLocale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(tag);

export const isLanguageSetting = (value: string): value is LanguageSetting =>
  value === SYSTEM_LANGUAGE || isSupportedLocale(value);

export const localeStatus = (tag: string): LocaleStatus => {
  if (tag === PSEUDO_RTL_LOCALE) return 'pseudo';
  return DRAFTS.has(tag) ? 'draft' : 'source';
};

const languageOf = (tag: string): string => tag.split('-')[0]?.toLowerCase() ?? '';

/**
 * The catalog for a preferred tag: an exact match first (`pt-BR`), then the same language
 * (`de-AT` → `de`, `pt-PT` → `pt-BR`), else nothing.
 */
const matchCatalog = (tag: string): SupportedLocale | undefined => {
  const exact = SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === tag.toLowerCase());
  if (exact !== undefined) return exact;
  const language = languageOf(tag);
  return SUPPORTED_LOCALES.find((locale) => languageOf(locale) === language);
};

/**
 * Which catalog the UI speaks. An explicit setting wins as it is; `system` (or anything
 * unknown, such as an older file) walks the OS's preferred tags in order and falls back to
 * English. The pseudo-locale is honoured when asked for by name, for Storybook.
 */
export function resolveCatalogLocale(
  setting: string,
  preferred: readonly string[],
): SupportedLocale | typeof PSEUDO_RTL_LOCALE {
  if (setting === PSEUDO_RTL_LOCALE) return PSEUDO_RTL_LOCALE;
  if (isSupportedLocale(setting)) return setting;
  for (const tag of preferred) {
    const match = matchCatalog(tag);
    if (match !== undefined) return match;
  }
  return 'en';
}

const isWellFormedTag = (tag: string): boolean => {
  if (tag.trim() === '') return false;
  try {
    return Intl.getCanonicalLocales(tag).length > 0;
  } catch {
    return false;
  }
};

/**
 * The tag `Intl` formats dates and numbers with. Under `system` it is the Windows regional
 * format (Settings → Time & language → Region), which is the user's own choice and may differ
 * from the display language; without one, the display language. An explicit language formats
 * in that language, so a chosen German UI also gets German dates and decimal commas. The
 * pseudo-locale formats as English: its point is the direction, not Arabic numerals.
 */
export function resolveFormatLocale(
  setting: string,
  regionFormat: string | undefined,
  preferred: readonly string[],
): string {
  if (setting === PSEUDO_RTL_LOCALE) return 'en';
  if (isSupportedLocale(setting)) return setting;
  const candidates = [regionFormat ?? '', ...preferred];
  return candidates.find(isWellFormedTag) ?? 'en';
}

const NATIVE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
};

/**
 * A catalog's name in its own language, as language pickers show them (`Deutsch`, not
 * `German`), from `Intl.DisplayNames` with the first letter raised, since CLDR spells several
 * languages in lower case mid-sentence. The pseudo-locale names itself in English.
 */
export function localeDisplayName(tag: string): string {
  if (tag === PSEUDO_RTL_LOCALE) return 'Pseudo RTL';
  try {
    const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag);
    if (name !== undefined && name !== tag) {
      return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
    }
  } catch {
    // Unknown tag or no ICU data: use the table.
  }
  return NATIVE_NAMES[tag] ?? tag;
}

/** U+202E RIGHT-TO-LEFT OVERRIDE … U+202C POP DIRECTIONAL FORMATTING. */
const RLO = '\u202E';
const PDF = '\u202C';

/** One message of the pseudo-locale: the English text, displayed mirrored. */
export const pseudoRtlMessage = (text: string): string => `${RLO}${text}${PDF}`;
