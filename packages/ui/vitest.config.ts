import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Vitest replaces every CSS import with "" unless included; `tokens.css?raw` must survive
    // so `src/tokens/index.ts` can parse the token list. Vite itself skips `?raw` in its CSS
    // pipeline, so this only affects tests.
    css: { include: [/[?&]raw\b/] },
  },
});
