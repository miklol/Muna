import { createI18n } from '@muna/i18n';

export const i18n = createI18n({
  lng: typeof navigator === 'undefined' ? 'en' : navigator.language,
});
