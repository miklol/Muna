import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PanelWarmup } from './panel-warmup';

/** Lets React commit the hidden copy and the observer that waits for it run. */
const flushEffects = () => act(() => Promise.resolve());

const measureNode = () => document.querySelector<HTMLElement>('[data-warmup-measure]');

/** Gives the measurement node a laid-out height and records how the copy looked when read. */
const layOut = (height: number) => {
  const seen: string[] = [];
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const copy = screen.getByTestId('panel-warmup').firstElementChild as HTMLElement;
    seen.push(copy.style.getPropertyValue('display'));
    return DOMRect.fromRect({
      width: 600,
      height: this.hasAttribute('data-warmup-measure') ? height : 0,
    });
  });
  return seen;
};

const renderWarmup = (onMeasure = vi.fn(), mounted = vi.fn()) => {
  const Body = () => {
    useEffect(() => {
      mounted();
    }, []);
    return <p>warm body</p>;
  };
  const view = render(
    <PanelWarmup shape="notch" width={720} maxHeight={360} onMeasure={onMeasure} panel={<Body />}>
      <nav>module bar</nav>
    </PanelWarmup>,
  );
  return { ...view, onMeasure, mounted };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PanelWarmup (#81)', () => {
  it('lays the copy out once, unpainted, and reports the panel height', async () => {
    const seen = layOut(286.5);
    const { onMeasure, mounted } = renderWarmup();
    await flushEffects();

    const host = screen.getByTestId('panel-warmup');
    expect(host).toHaveAttribute('aria-hidden', 'true');
    expect(host).toHaveAttribute('inert');
    // Read with React's `display: none` lifted, then hidden again before the task ends.
    expect(seen).toEqual(['']);
    const copy = host.firstElementChild as HTMLElement;
    expect(copy.style.getPropertyValue('display')).toBe('none');
    expect(copy.style.getPropertyPriority('display')).toBe('important');
    expect(screen.getByText('warm body')).not.toBeVisible();
    expect(screen.getByText('module bar')).not.toBeVisible();
    expect(onMeasure).toHaveBeenCalledTimes(1);
    expect(onMeasure).toHaveBeenCalledWith(286.5);
    // Only the panel sits in the measured node, capped like the shell's.
    expect(measureNode()).toContainElement(screen.getByText('warm body'));
    expect(measureNode()).not.toContainElement(screen.getByText('module bar'));
    expect(measureNode()).toHaveStyle({ maxHeight: '360px' });
    // The hidden copy never runs its effects: no timer, frame loop or fetch starts for it.
    expect(mounted).not.toHaveBeenCalled();
  });

  it('reports nothing when the copy has no height (not laid out)', async () => {
    layOut(0);
    const { onMeasure } = renderWarmup();
    await flushEffects();
    expect(onMeasure).not.toHaveBeenCalled();
    expect(screen.getByText('warm body')).not.toBeVisible();
  });

  it('leaves no observer behind', async () => {
    layOut(240);
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const observe = vi.spyOn(MutationObserver.prototype, 'observe');
    const { unmount } = renderWarmup();
    await flushEffects();
    unmount();
    expect(disconnect.mock.calls.length).toBeGreaterThanOrEqual(observe.mock.calls.length);
  });
});
