import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from './app-providers';
import { SettingsApp } from './settings/settings-app';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('settings.html is missing #root');
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <SettingsApp />
    </AppProviders>
  </StrictMode>,
);
