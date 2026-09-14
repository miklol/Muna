import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from './app-providers';
import { NotchWindow } from './shell/notch-window';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html is missing #root');
}

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <NotchWindow />
    </AppProviders>
  </StrictMode>,
);
