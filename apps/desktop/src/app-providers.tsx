import { QueryClientProvider } from '@tanstack/react-query';
import { MunaMotionProvider } from '@muna/ui/motion';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n } from './lib/i18n';
import { queryClient } from './lib/query-client';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Providers shared by both windows. `MunaMotionProvider` follows the OS reduced-motion
 * preference; the app's own setting is wired to its `reduceMotion` prop with the settings
 * window (M1-E3).
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MunaMotionProvider>{children}</MunaMotionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
