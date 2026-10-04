import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// One page, anchor navigation only, so relative asset URLs let the same build serve from a
// project page (`/Muna/`), a custom domain or `vite preview` (docs/11-ci-cd.md, `site.yml`).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 1430, strictPort: true },
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks cache across content edits; the page's own code stays small.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            {
              name: 'motion',
              test: /node_modules[\\/](motion|framer-motion|motion-dom|motion-utils)[\\/]/,
            },
            {
              name: 'aria',
              test: /node_modules[\\/](react-aria|react-stately|@react-aria|@react-stately|@react-types|@internationalized|@swc[\\/]helpers|use-sync-external-store|clsx)[\\/]/,
            },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
          ],
        },
      },
    },
  },
});
