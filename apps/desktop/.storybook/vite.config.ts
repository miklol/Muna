import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite for the desktop Storybook only (see main.ts): the same React and Tailwind plugins as
// the app, none of the Tauri dev-server or two-page build settings from ../vite.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
