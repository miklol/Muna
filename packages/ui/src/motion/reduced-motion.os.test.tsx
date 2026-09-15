import { renderHook } from '@testing-library/react';
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

import { reducedMotionTransition } from './presets';
import { useMotionPreset, useReduceMotion } from './reduced-motion';

describe('OS prefers-reduced-motion', () => {
  it('reduces motion without any app setting or provider', () => {
    expect(renderHook(() => useReduceMotion()).result.current).toBe(true);
    expect(renderHook(() => useMotionPreset('expand')).result.current).toBe(
      reducedMotionTransition,
    );
  });
});
