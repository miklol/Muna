import { render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { reduceMotionAttribute } from './css-vars';
import { reducedMotionTransition, springs } from './presets';
import {
  MunaMotionProvider,
  resolveMotionPreset,
  useHoldTime,
  useMotionPreset,
  useReduceMotion,
} from './reduced-motion';

const withProvider =
  (reduceMotion: boolean) =>
  ({ children }: { children: ReactNode }) => (
    <MunaMotionProvider reduceMotion={reduceMotion}>{children}</MunaMotionProvider>
  );

describe('useMotionPreset', () => {
  it('returns the physics spring by default', () => {
    const { result } = renderHook(() => useMotionPreset('expand'), {
      wrapper: withProvider(false),
    });
    expect(result.current).toBe(springs.expand);
  });

  it('returns the 150 ms ease-out when the app setting is on', () => {
    const { result } = renderHook(() => useMotionPreset('expand'), {
      wrapper: withProvider(true),
    });
    expect(result.current).toBe(reducedMotionTransition);
  });

  it('works without a provider (OS preference only)', () => {
    const { result } = renderHook(() => useMotionPreset('notice'));
    expect(result.current).toBe(springs.notice);
  });
});

describe('useReduceMotion / useHoldTime', () => {
  it('adds 50 % to hold times under reduced motion only', () => {
    const on = renderHook(() => useHoldTime(4000), { wrapper: withProvider(true) });
    const off = renderHook(() => useHoldTime(4000), { wrapper: withProvider(false) });
    expect(on.result.current).toBe(6000);
    expect(off.result.current).toBe(4000);
  });

  it('is off when neither switch is on', () => {
    const { result } = renderHook(() => useReduceMotion(), { wrapper: withProvider(false) });
    expect(result.current).toBe(false);
  });
});

describe('MunaMotionProvider and <html>', () => {
  it('mirrors the setting as an attribute and publishes the preset easings', () => {
    const { rerender } = render(<MunaMotionProvider reduceMotion>x</MunaMotionProvider>);
    const html = document.documentElement;
    expect(html.hasAttribute(reduceMotionAttribute)).toBe(true);
    expect(html.style.getPropertyValue('--muna-motion-press')).toMatch(/^\d+ms linear\(/);
    rerender(<MunaMotionProvider reduceMotion={false}>x</MunaMotionProvider>);
    expect(html.hasAttribute(reduceMotionAttribute)).toBe(false);
  });

  it('lets only the outermost provider write to <html>', () => {
    render(
      <MunaMotionProvider reduceMotion={false}>
        <MunaMotionProvider reduceMotion>
          <Probe />
        </MunaMotionProvider>
      </MunaMotionProvider>,
    );
    expect(document.documentElement.hasAttribute(reduceMotionAttribute)).toBe(false);
    expect(screen.getByTestId('probe')).toHaveTextContent('reduced');
  });
});

function Probe() {
  return <span data-testid="probe">{useReduceMotion() ? 'reduced' : 'full'}</span>;
}

describe('resolveMotionPreset', () => {
  it('is the non-hook equivalent', () => {
    expect(resolveMotionPreset('collapse', false)).toBe(springs.collapse);
    expect(resolveMotionPreset('collapse', true)).toBe(reducedMotionTransition);
  });
});
