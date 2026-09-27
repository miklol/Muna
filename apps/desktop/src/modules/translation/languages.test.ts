import { describe, expect, it } from 'vitest';

import { filterLanguages, isKnownLanguage, languageName, LANGUAGES } from './languages';

describe('languages', () => {
  it('offers a closed list of unique BCP-47 tags with English first', () => {
    expect(LANGUAGES[0]).toBe('en');
    expect(new Set(LANGUAGES).size).toBe(LANGUAGES.length);
    expect(LANGUAGES.length).toBeGreaterThanOrEqual(30);
    for (const tag of LANGUAGES) expect(tag).toMatch(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/u);
  });

  it('names a tag in the UI locale and falls back to the tag', () => {
    expect(languageName('de', 'en')).toBe('German');
    expect(languageName('de', 'fr')).toBe('allemand');
    expect(languageName('zh-Hant', 'en')).toBe('Chinese (Traditional)');
    expect(languageName('pt-BR', 'en')).toBe('Portuguese (Brazil)');
    expect(languageName('auto', 'en')).toBe('auto');
    expect(languageName('!!', 'en')).toBe('!!');
  });

  it('knows its own tags and auto, nothing else', () => {
    expect(isKnownLanguage('auto')).toBe(true);
    expect(isKnownLanguage('ja')).toBe(true);
    expect(isKnownLanguage('tlh')).toBe(false);
  });

  it('filters by localized name or tag, case-insensitively; blank means everything', () => {
    expect(filterLanguages('', 'en')).toBe(LANGUAGES);
    expect(filterLanguages('  ', 'en')).toBe(LANGUAGES);
    expect(filterLanguages('GERM', 'en')).toEqual(['de']);
    expect(filterLanguages('allem', 'fr')).toEqual(['de']);
    expect(filterLanguages('zh', 'en')).toEqual(['zh-Hans', 'zh-Hant']);
    expect(filterLanguages('portug', 'en')).toEqual(['pt', 'pt-BR']);
    expect(filterLanguages('klingon', 'en')).toEqual([]);
  });
});
