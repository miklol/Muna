import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Motion reads `prefers-reduced-motion` once and caches it, so the stub must exist before
// the first hook renders — hence a dedicated file with a hoisted stub.
vi.hoisted(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
});

import { reducedMotionTransition, springs } from './presets';
import { MunaMotionProvider, useMotionPreset, useReduceMotion } from './reduced-motion';

describe('OS prefers-reduced-motion', () => {
  it('reduces motion without any app setting or provider', () => {
    expect(renderHook(() => useReduceMotion()).result.current).toBe(true);
    expect(renderHook(() => useMotionPreset('expand')).result.current).toBe(
      reducedMotionTransition,
    );
  });

  it('is ignored by a measurement provider, unless the app setting is on too', () => {
    const ignoring = ({ children }: { children: ReactNode }) => (
      <MunaMotionProvider ignoreSystemPreference>{children}</MunaMotionProvider>
    );
    expect(renderHook(() => useReduceMotion(), { wrapper: ignoring }).result.current).toBe(false);
    expect(renderHook(() => useMotionPreset('expand'), { wrapper: ignoring }).result.current).toBe(
      springs.expand,
    );

    const settingWins = ({ children }: { children: ReactNode }) => (
      <MunaMotionProvider reduceMotion ignoreSystemPreference>
        {children}
      </MunaMotionProvider>
    );
    expect(renderHook(() => useReduceMotion(), { wrapper: settingWins }).result.current).toBe(true);
  });
});
