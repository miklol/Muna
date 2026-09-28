import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { MunaMotionProvider } from '@muna/ui/motion';
import { type ReactNode, useEffect } from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { useAccent, useContrast } from './lib/appearance';
import { i18n } from './lib/i18n';
import { appInfoQuery, applyDocumentLocale, LocaleProvider, resolveLocale } from './lib/locale';
import { queryClient } from './lib/query-client';
import { useSettings, useSettingsSubscription } from './lib/settings';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Dev builds only: `VITE_MUNA_FULL_MOTION=1` (`scripts/dev.ps1 -FullMotion`) runs the springs
 * even where the OS asks for reduced motion, so morph frame rates can be measured on machines
 * with animations off. Release builds always follow the OS.
 */
const ignoreSystemMotionPreference: boolean =
  import.meta.env.DEV && import.meta.env.VITE_MUNA_FULL_MOTION === '1';

interface SettingsBridgeProps {
  children: ReactNode;
}

/**
 * Feeds the settings document into the window: the accent and the contrast switch onto
 * `<html>`, Settings → General → Language into i18next (both windows switch the moment the
 * document changes, no relaunch) and the `Intl` tag into `LocaleProvider`, and Settings →
 * Appearance → Reduce motion into `MunaMotionProvider`, which adds it to the OS preference.
 * The `off` value is kept for older files and behaves like `system` (docs/06-motion-spec.md).
 */
function SettingsBridge({ children }: SettingsBridgeProps) {
  useSettingsSubscription();
  const settings = useSettings();
  const info = useQuery(appInfoQuery).data;
  const { i18n: instance } = useTranslation();
  useAccent(settings?.general.accent);
  useContrast(settings?.general.contrast);
  const { catalog, format } = resolveLocale(settings?.general.language, info?.regionFormat);
  useEffect(() => {
    if (instance.language !== catalog) {
      void instance.changeLanguage(catalog);
    }
    applyDocumentLocale(instance);
  }, [instance, catalog]);
  return (
    <LocaleProvider value={format}>
      <MunaMotionProvider
        reduceMotion={settings?.general.reducedMotion === 'on'}
        ignoreSystemPreference={ignoreSystemMotionPreference}
      >
        {children}
      </MunaMotionProvider>
    </LocaleProvider>
  );
}

/** Providers shared by both windows. */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <SettingsBridge>{children}</SettingsBridge>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
