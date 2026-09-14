import { describe, expect, it } from 'vitest';

import { createI18n, type MessageKey } from './index';

describe('createI18n', () => {
  it('resolves English messages synchronously', () => {
    const i18n = createI18n();
    expect(i18n.isInitialized).toBe(true);
    expect(i18n.t('app.name')).toBe('Muna');
    expect(i18n.t('settings.version', { version: '0.0.0' })).toBe('Version 0.0.0');
  });

  it('falls back to English for unknown locales', () => {
    const i18n = createI18n({ lng: 'xx-XX' });
    expect(i18n.t('settings.title')).toBe('Muna settings');
  });

  it('types keys as dotted paths', () => {
    const key: MessageKey = 'settings.loading';
    expect(createI18n().t(key)).toBe('Loading settings…');
  });
});
