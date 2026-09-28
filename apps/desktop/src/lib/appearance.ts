import type { Contrast } from '@muna/contracts';
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

/**
 * Mirrors Settings → Appearance → Increase contrast as `data-contrast="more"` on `<html>`,
 * where `tokens.css` steps hairlines and secondary text up and drops the media tints
 * (docs/05-design-system.md "Accessibility"). `system` removes the attribute and leaves
 * Windows contrast themes to `prefers-contrast: more`, which the same stylesheet honours.
 */
export function useContrast(contrast: Contrast | undefined): void {
  useEffect(() => {
    if (contrast === undefined) return;
    if (contrast === 'more') {
      document.documentElement.dataset.contrast = 'more';
    } else {
      delete document.documentElement.dataset.contrast;
    }
  }, [contrast]);
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
