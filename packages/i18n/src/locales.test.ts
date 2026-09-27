import { describe, expect, it } from 'vitest';

import {
  isLanguageSetting,
  localeDisplayName,
  localeStatus,
  PSEUDO_RTL_LOCALE,
  pseudoRtlMessage,
  resolveCatalogLocale,
  resolveFormatLocale,
  SUPPORTED_LOCALES,
} from './locales';

describe('resolveCatalogLocale', () => {
  it('keeps an explicit catalog as it is', () => {
    expect(resolveCatalogLocale('de', ['en-US'])).toBe('de');
    expect(resolveCatalogLocale('pt-BR', ['fr-FR'])).toBe('pt-BR');
  });

  it('walks the preferred tags in order under system', () => {
    expect(resolveCatalogLocale('system', ['it-IT', 'fr-CA', 'en-US'])).toBe('fr');
    expect(resolveCatalogLocale('system', ['de-AT'])).toBe('de');
    expect(resolveCatalogLocale('system', ['pt-PT'])).toBe('pt-BR');
    expect(resolveCatalogLocale('system', ['PT-br'])).toBe('pt-BR');
  });

  it('falls back to English when nothing matches or the setting is unknown', () => {
    expect(resolveCatalogLocale('system', ['ja-JP'])).toBe('en');
    expect(resolveCatalogLocale('system', [])).toBe('en');
    expect(resolveCatalogLocale('klingon', ['de-DE'])).toBe('de');
    expect(resolveCatalogLocale('klingon', [])).toBe('en');
  });

  it('honours the pseudo-locale by name only', () => {
    expect(resolveCatalogLocale(PSEUDO_RTL_LOCALE, ['de-DE'])).toBe(PSEUDO_RTL_LOCALE);
    expect(resolveCatalogLocale('system', [PSEUDO_RTL_LOCALE])).toBe('en');
  });
});

describe('resolveFormatLocale', () => {
  it('uses the Windows regional format under system', () => {
    expect(resolveFormatLocale('system', 'de-CH', ['en-US'])).toBe('de-CH');
  });

  it('falls back to the display language without a regional format', () => {
    expect(resolveFormatLocale('system', undefined, ['en-GB', 'en'])).toBe('en-GB');
    expect(resolveFormatLocale('system', '', ['en-GB'])).toBe('en-GB');
  });

  it('skips a malformed tag', () => {
    expect(resolveFormatLocale('system', 'not a tag', ['fr-FR'])).toBe('fr-FR');
    expect(resolveFormatLocale('system', 'nope!', [])).toBe('en');
  });

  it('formats in the chosen language', () => {
    expect(resolveFormatLocale('de', 'en-US', ['en-US'])).toBe('de');
    expect(resolveFormatLocale('pt-BR', 'en-US', ['en-US'])).toBe('pt-BR');
  });

  it('formats the pseudo-locale as English', () => {
    expect(resolveFormatLocale(PSEUDO_RTL_LOCALE, 'ar-SA', ['ar-SA'])).toBe('en');
  });
});

describe('locale metadata', () => {
  it('accepts system and every catalog as a setting', () => {
    expect(isLanguageSetting('system')).toBe(true);
    for (const tag of SUPPORTED_LOCALES) expect(isLanguageSetting(tag)).toBe(true);
    expect(isLanguageSetting('ja')).toBe(false);
    expect(isLanguageSetting(PSEUDO_RTL_LOCALE)).toBe(false);
  });

  it('marks English as the source and the others as drafts', () => {
    expect(localeStatus('en')).toBe('source');
    expect(localeStatus('de')).toBe('draft');
    expect(localeStatus('pt-BR')).toBe('draft');
    expect(localeStatus(PSEUDO_RTL_LOCALE)).toBe('pseudo');
  });

  it('names a catalog in its own language, capitalised', () => {
    expect(localeDisplayName('en')).toBe('English');
    expect(localeDisplayName('de')).toBe('Deutsch');
    expect(localeDisplayName('fr')).toBe('Français');
    expect(localeDisplayName('es')).toBe('Español');
    expect(localeDisplayName('pt-BR')).toMatch(/^Português/);
    expect(localeDisplayName(PSEUDO_RTL_LOCALE)).toBe('Pseudo RTL');
  });
});

describe('pseudoRtlMessage', () => {
  it('wraps the text in a right-to-left override and pops it', () => {
    expect(pseudoRtlMessage('Settings')).toBe('\u202ESettings\u202C');
  });
});
