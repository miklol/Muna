import { describe, expect, it } from 'vitest';

import { createI18n, type MessageKey, PSEUDO_RTL_LOCALE, resources } from './index';

describe('createI18n', () => {
  it('resolves English messages synchronously', () => {
    const i18n = createI18n();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('app.name')).toBe('Muna');
    expect(i18n.t('settings.version', { version: '0.0.0' })).toBe('Version 0.0.0');
  });

  it('falls back to English for unknown locales', () => {
    const i18n = createI18n({ lng: 'xx-XX' });
    expect(i18n.language).toBe('en');
    expect(i18n.t('settings.title')).toBe('Muna settings');
  });

  it('types keys as dotted paths', () => {
    const key: MessageKey = 'settings.loading';
    expect(createI18n().t(key)).toBe('Loading settings…');
  });

  it('switches catalogs synchronously and maps a region to its language', () => {
    const i18n = createI18n({ lng: 'de-AT' });
    expect(i18n.language).toBe('de');
    void i18n.changeLanguage('pt-PT');
    expect(i18n.language).toBe('pt-BR');
    void i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
  });

  it('ships every catalog with the English key set and no review notes', () => {
    const enKeys = Object.keys(resources.en.translation).sort();
    for (const [tag, bundle] of Object.entries(resources)) {
      const keys = Object.keys(bundle.translation);
      expect(
        keys.some((key) => key.includes('_review')),
        tag,
      ).toBe(false);
      expect(keys.sort(), tag).toEqual(enKeys);
    }
  });

  it('mirrors English in the pseudo-locale and reads right to left', () => {
    const i18n = createI18n({ lng: PSEUDO_RTL_LOCALE });
    expect(i18n.language).toBe(PSEUDO_RTL_LOCALE);
    expect(i18n.dir()).toBe('rtl');
    expect(i18n.t('settings.title')).toBe('\u202EMuna settings\u202C');
    expect(i18n.t('settings.version', { version: '1.0' })).toBe('\u202EVersion 1.0\u202C');
  });
});
