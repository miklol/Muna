import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMinuteNow } from './minute-now';

describe('useMinuteNow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 9, 0, 40));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('ticks at the next whole minute with one timer, then keeps to the minute, and stops on unmount', async () => {
    const { result, unmount } = renderHook(() => useMinuteNow());
    expect(result.current.getMinutes()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000);
    });
    expect(result.current.getMinutes()).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.getMinutes()).toBe(1);
    expect(result.current.getSeconds()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current.getMinutes()).toBe(2);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
