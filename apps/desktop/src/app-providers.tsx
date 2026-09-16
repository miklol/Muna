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
 * Dev builds only: `VITE_MUNA_FULL_MOTION=1` (`scripts/dev.ps1 -FullMotion`) runs the springs
 * even where the OS asks for reduced motion, so morph frame rates can be measured on machines
 * with animations off. Release builds always follow the OS.
 */
const ignoreSystemMotionPreference: boolean =
  import.meta.env.DEV && import.meta.env.VITE_MUNA_FULL_MOTION === '1';

/**
 * Providers shared by both windows. `MunaMotionProvider` follows the OS reduced-motion
 * preference; the app's own setting is wired to its `reduceMotion` prop with the settings
 * window (M1-E3).
 */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MunaMotionProvider ignoreSystemPreference={ignoreSystemMotionPreference}>
          {children}
        </MunaMotionProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
