import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { i18n } from './lib/i18n';
import { queryClient } from './lib/query-client';

interface AppProvidersProps {
  children: ReactNode;
}

/** Providers shared by both windows. `reducedMotion="user"` honours the OS setting. */
export function AppProviders({ children }: AppProvidersProps) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
