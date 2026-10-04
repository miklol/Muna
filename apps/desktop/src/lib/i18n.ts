import { createI18n } from '@muna/i18n';

import { resolveLocale } from './locale';

/**
 * The window's i18next instance, starting in the Windows display language; `SettingsBridge`
 * switches it once the settings document (and its language) has been read.
 */
export const i18n = createI18n({ lng: resolveLocale(undefined, undefined).catalog });
