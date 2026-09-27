import { createI18n, PSEUDO_RTL_LOCALE } from '@muna/i18n';
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDocumentLocale, LocaleProvider, resolveLocale, useLocale } from './locale';

const setLanguages = (languages: readonly string[]) => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([...languages]);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(languages[0] ?? 'en');
};

describe('resolveLocale', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('follows the Windows display language and regional format under system', () => {
    setLanguages(['de-CH', 'en-US']);
    expect(resolveLocale('system', 'de-CH')).toEqual({ catalog: 'de', format: 'de-CH' });
    expect(resolveLocale(undefined, undefined)).toEqual({ catalog: 'de', format: 'de-CH' });
  });

  it('keeps the regional format when the display language has no catalog', () => {
    setLanguages(['ja-JP', 'en-US']);
    expect(resolveLocale('system', 'ja-JP')).toEqual({ catalog: 'en', format: 'ja-JP' });
  });

  it('uses a chosen language for both the text and the formats', () => {
    setLanguages(['en-US']);
    expect(resolveLocale('pt-BR', 'en-US')).toEqual({ catalog: 'pt-BR', format: 'pt-BR' });
  });

  it('treats a value it does not know like system', () => {
    setLanguages(['fr-CA']);
    expect(resolveLocale('tlh', 'fr-CA')).toEqual({ catalog: 'fr', format: 'fr-CA' });
  });
});

describe('applyDocumentLocale', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('lang');
    document.documentElement.removeAttribute('dir');
  });

  it('mirrors the spoken language and its direction onto the document', () => {
    const i18n = createI18n({ lng: 'pt-BR' });
    applyDocumentLocale(i18n);
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('flips the pseudo-locale to right-to-left while keeping English for assistive tech', () => {
    const i18n = createI18n({ lng: PSEUDO_RTL_LOCALE });
    applyDocumentLocale(i18n);
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('useLocale', () => {
  it('reads the provider, and falls back to the display language without one', () => {
    expect(renderHook(() => useLocale()).result.current).toBe(navigator.language);
    const { result } = renderHook(() => useLocale(), {
      wrapper: ({ children }) => <LocaleProvider value="de-AT">{children}</LocaleProvider>,
    });
    expect(result.current).toBe('de-AT');
  });
});
