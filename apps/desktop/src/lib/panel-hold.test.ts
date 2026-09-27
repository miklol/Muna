import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useIsPanelHeld, usePanelHold, usePanelHoldStore } from './panel-hold';

describe('panel hold', () => {
  beforeEach(() => {
    usePanelHoldStore.setState({ holds: 0 });
  });

  it('counts holds and releases each one once', () => {
    const { acquire } = usePanelHoldStore.getState();
    const releaseA = acquire();
    const releaseB = acquire();
    expect(usePanelHoldStore.getState().holds).toBe(2);
    releaseA();
    releaseA();
    expect(usePanelHoldStore.getState().holds).toBe(1);
    releaseB();
    expect(usePanelHoldStore.getState().holds).toBe(0);
  });

  it('holds while active and lets go when inactive or unmounted', () => {
    const held = renderHook(() => useIsPanelHeld());
    const hold = renderHook(
      ({ active }: { active: boolean }) => {
        usePanelHold(active);
      },
      { initialProps: { active: false } },
    );
    expect(held.result.current).toBe(false);
    act(() => {
      hold.rerender({ active: true });
    });
    expect(held.result.current).toBe(true);
    act(() => {
      hold.rerender({ active: false });
    });
    expect(held.result.current).toBe(false);
    act(() => {
      hold.rerender({ active: true });
    });
    expect(held.result.current).toBe(true);
    act(() => {
      hold.unmount();
    });
    expect(held.result.current).toBe(false);
  });
});
