import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetCornerShapeSupport } from '../shape/squircle';
import { NotchSurface } from './notch-surface';

type ResizeCallback = (entries: ResizeObserverEntry[]) => void;

/** Minimal ResizeObserver: reports the size handed to `resizeTo`. */
let callbacks: ResizeCallback[] = [];
const resizeTo = (width: number, height: number) => {
  const entry = { borderBoxSize: [{ inlineSize: width, blockSize: height }] };
  act(() => {
    for (const cb of callbacks) cb([entry as unknown as ResizeObserverEntry]);
  });
};

beforeEach(() => {
  callbacks = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeCallback) {
        callbacks.push(cb);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('NotchSurface', () => {
  it('renders shape and state classes with the flare custom property', () => {
    const { container } = render(
      <NotchSurface shape="notch" state="collapsed">
        content
      </NotchSurface>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveClass(
      'muna-notch-surface',
      'muna-notch-surface--notch',
      'muna-notch-surface--collapsed',
    );
    expect(root.style.getPropertyValue('--muna-notch-flare')).toBe('6px');
    expect(root.querySelector('.muna-notch-surface__content')).toHaveTextContent('content');
  });

  it('clips to the notch path once measured and draws the outline along it', () => {
    const { container } = render(<NotchSurface shape="notch" state="collapsed" />);
    const root = container.firstElementChild as HTMLElement;
    resizeTo(212, 32);
    expect(root).toHaveClass('muna-notch-surface--clipped');
    const shape = root.querySelector<HTMLElement>('.muna-notch-surface__shape')!;
    expect(shape.style.clipPath).toContain('M 0 0 A 6 6 0 0 1 6 6');
    const outline = root.querySelector('.muna-notch-surface__outline path');
    expect(outline?.getAttribute('d')).not.toContain('Z');
  });

  it('drops the mask while morphing', () => {
    const { container, rerender } = render(<NotchSurface shape="notch" state="expanded" />);
    const root = container.firstElementChild as HTMLElement;
    resizeTo(400, 200);
    expect(root).toHaveClass('muna-notch-surface--clipped');
    rerender(<NotchSurface shape="notch" state="expanded" morphing />);
    expect(root).toHaveClass('muna-notch-surface--morphing');
    expect(root).not.toHaveClass('muna-notch-surface--clipped');
    expect(root.querySelector('.muna-notch-surface__outline')).toBeNull();
  });

  it('gives islands no flare and a squircle clip when corner-shape is unsupported', () => {
    // jsdom's CSS.supports answers true to everything; pin the fallback branch.
    vi.spyOn(CSS, 'supports').mockReturnValue(false);
    resetCornerShapeSupport();
    const { container } = render(<NotchSurface shape="island" state="expanded" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.getPropertyValue('--muna-notch-flare')).toBe('0px');
    resizeTo(240, 120);
    expect(root).toHaveClass('muna-notch-surface--clipped');
    const shape = root.querySelector<HTMLElement>('.muna-notch-surface__shape')!;
    expect(shape.style.clipPath).toMatch(/^path\("M /);
    resetCornerShapeSupport();
  });

  it('relies on border-radius for islands when corner-shape is supported', () => {
    vi.spyOn(CSS, 'supports').mockReturnValue(true);
    resetCornerShapeSupport();
    const { container } = render(<NotchSurface shape="island" state="expanded" />);
    const root = container.firstElementChild as HTMLElement;
    resizeTo(240, 120);
    expect(root).not.toHaveClass('muna-notch-surface--clipped');
    const shape = root.querySelector<HTMLElement>('.muna-notch-surface__shape')!;
    expect(shape.style.getPropertyValue('corner-shape')).toBe('squircle');
    resetCornerShapeSupport();
  });
});
