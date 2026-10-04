import type { Contrast } from '@muna/contracts';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { accents, isAccent, useAccent, useContrast, useSystemTheme } from './appearance';

describe('appearance', () => {
  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset.accent;
    delete document.documentElement.dataset.contrast;
    delete document.documentElement.dataset.theme;
  });

  it('knows the eight design-system accents', () => {
    expect(accents).toHaveLength(8);
    expect(isAccent('purple')).toBe(true);
    expect(isAccent('magenta')).toBe(false);
  });

  it('mirrors the accent onto <html> and falls back to blue for unknown names', () => {
    const { rerender } = renderHook(
      ({ accent }: { accent: string | undefined }) => {
        useAccent(accent);
      },
      { initialProps: { accent: undefined as string | undefined } },
    );
    expect(document.documentElement.dataset.accent).toBeUndefined();
    rerender({ accent: 'green' });
    expect(document.documentElement.dataset.accent).toBe('green');
    rerender({ accent: 'not-a-colour' });
    expect(document.documentElement.dataset.accent).toBe('blue');
  });

  it('mirrors the contrast switch onto <html> and removes it for system', () => {
    const { rerender } = renderHook(
      ({ contrast }: { contrast: Contrast | undefined }) => {
        useContrast(contrast);
      },
      { initialProps: { contrast: undefined as Contrast | undefined } },
    );
    expect(document.documentElement.dataset.contrast).toBeUndefined();
    rerender({ contrast: 'more' });
    expect(document.documentElement.dataset.contrast).toBe('more');
    rerender({ contrast: 'system' });
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });

  it('follows prefers-color-scheme while mounted', () => {
    let matches = true;
    const listeners = new Set<() => void>();
    // jsdom has no matchMedia; install one for this test and remove it again afterwards.
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          get matches() {
            return matches;
          },
          media: query,
          addEventListener: (_type: string, listener: () => void) => {
            listeners.add(listener);
          },
          removeEventListener: (_type: string, listener: () => void) => {
            listeners.delete(listener);
          },
        }) as unknown as MediaQueryList,
    });
    const { unmount } = renderHook(() => {
      useSystemTheme();
    });
    expect(document.documentElement.dataset.theme).toBe('light');
    matches = false;
    for (const listener of listeners) listener();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    matches = true;
    for (const listener of listeners) listener();
    expect(document.documentElement.dataset.theme).toBe('light');
    unmount();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(listeners.size).toBe(0);
    Reflect.deleteProperty(window, 'matchMedia');
  });
});
