import { useEffect } from 'react';

/** Accent names from docs/05-design-system.md (`--accent-*`); `blue` is the default. */
export const accents = [
  'blue',
  'cyan',
  'green',
  'orange',
  'red',
  'purple',
  'yellow',
  'pink',
] as const;

export type Accent = (typeof accents)[number];

export const isAccent = (value: string): value is Accent =>
  (accents as readonly string[]).includes(value);

/**
 * Mirrors Settings → Appearance → Accent as `data-accent` on `<html>`, where `tokens.css`
 * turns it into `--accent`. Unknown names (an older export, a typo in the file) fall back to
 * blue rather than leaving the previous accent in place.
 */
export function useAccent(accent: string | undefined): void {
  useEffect(() => {
    if (accent === undefined) return;
    document.documentElement.dataset.accent = isAccent(accent) ? accent : 'blue';
  }, [accent]);
}

const lightQuery = '(prefers-color-scheme: light)';

/**
 * Settings window only: follows the Windows app theme through `prefers-color-scheme`, setting
 * `data-theme="light"` on `<html>` (`tokens.css` inverts the neutrals). The notch stays dark
 * regardless of theme, so the notch window never calls this.
 */
export function useSystemTheme(): void {
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(lightQuery);
    const apply = () => {
      if (query.matches) {
        document.documentElement.dataset.theme = 'light';
      } else {
        delete document.documentElement.dataset.theme;
      }
    };
    apply();
    query.addEventListener('change', apply);
    return () => {
      query.removeEventListener('change', apply);
      delete document.documentElement.dataset.theme;
    };
  }, []);
}
