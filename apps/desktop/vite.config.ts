import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Set by `tauri dev` when targeting a remote device; unused on Windows but harmless.
const host = process.env.TAURI_DEV_HOST;
const isTauriDebug = Boolean(process.env.TAURI_ENV_DEBUG);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host ? { hmr: { protocol: 'ws', host, port: 1421 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: {
    // WebView2 is evergreen Chromium; no legacy targets needed.
    target: 'chrome120',
    minify: !isTauriDebug,
    sourcemap: isTauriDebug,
    rollupOptions: {
      input: {
        notch: 'index.html',
        settings: 'settings.html',
      },
    },
  },
});
