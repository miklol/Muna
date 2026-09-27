import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MINUTE_MS, SECOND_MS } from './format';
import { SAMPLE_NOW_MS, sampleSnapshot } from './sample-snapshot';
import { useHealthClock } from './use-health-clock';

describe('useHealthClock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SAMPLE_NOW_MS);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the snapshot as is before a second has passed, and frozen zeros without one', () => {
    const { result, rerender } = renderHook(
      ({ snapshot }) => useHealthClock(snapshot, SAMPLE_NOW_MS),
      { initialProps: { snapshot: null as ReturnType<typeof sampleSnapshot> | null } },
    );
    expect(result.current).toEqual({
      sittingMs: 0,
      nextBreakInMs: null,
      flowRemainingMs: null,
      flowElapsedMs: null,
    });
    rerender({ snapshot: sampleSnapshot() });
    expect(result.current.sittingMs).toBe(34 * MINUTE_MS);
    expect(result.current.nextBreakInMs).toBe(16 * MINUTE_MS);
    expect(result.current.flowRemainingMs).toBeNull();
  });

  it('ticks once a second while sitting: the sit counts up, the reminder counts down', () => {
    const { result } = renderHook(() => useHealthClock(sampleSnapshot(), SAMPLE_NOW_MS));
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(3 * SECOND_MS + 400);
    });
    expect(result.current.sittingMs).toBe(34 * MINUTE_MS + 3 * SECOND_MS);
    expect(result.current.nextBreakInMs).toBe(16 * MINUTE_MS - 3 * SECOND_MS);
    act(() => {
      vi.advanceTimersByTime(20 * MINUTE_MS);
    });
    expect(result.current.nextBreakInMs).toBe(0);
  });

  it('counts a flow down and its elapsed time up, clamped at the end', () => {
    const flow = {
      flow: 'eyeRest' as const,
      startedMs: SAMPLE_NOW_MS,
      remainingMs: 20 * SECOND_MS,
      totalMs: 20 * SECOND_MS,
      pattern: 'box' as const,
    };
    const { result } = renderHook(() =>
      useHealthClock(sampleSnapshot({ sitting: 'away', nextBreakInMs: null, flow }), SAMPLE_NOW_MS),
    );
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(5 * SECOND_MS);
    });
    expect(result.current.flowRemainingMs).toBe(15 * SECOND_MS);
    expect(result.current.flowElapsedMs).toBe(5 * SECOND_MS);
    act(() => {
      vi.advanceTimersByTime(MINUTE_MS);
    });
    expect(result.current.flowRemainingMs).toBe(0);
    expect(result.current.flowElapsedMs).toBe(20 * SECOND_MS);
  });

  it('subscribes to nothing while away, locked or off without a flow, and stops on unmount', () => {
    const { result, rerender, unmount } = renderHook(
      ({ snapshot }) => useHealthClock(snapshot, SAMPLE_NOW_MS),
      { initialProps: { snapshot: sampleSnapshot({ sitting: 'away', nextBreakInMs: null }) } },
    );
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(5 * MINUTE_MS);
    });
    expect(result.current.sittingMs).toBe(34 * MINUTE_MS);

    rerender({ snapshot: sampleSnapshot({ sitting: 'locked', nextBreakInMs: null }) });
    expect(vi.getTimerCount()).toBe(0);
    rerender({ snapshot: sampleSnapshot({ sitting: 'off', enabled: false, nextBreakInMs: null }) });
    expect(vi.getTimerCount()).toBe(0);

    rerender({ snapshot: sampleSnapshot() });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the interpolation from a fresh snapshot', () => {
    const { result, rerender } = renderHook(
      ({ receivedAt, sittingMs }) => useHealthClock(sampleSnapshot({ sittingMs }), receivedAt),
      { initialProps: { receivedAt: SAMPLE_NOW_MS, sittingMs: 34 * MINUTE_MS } },
    );
    act(() => {
      vi.advanceTimersByTime(10 * SECOND_MS);
    });
    expect(result.current.sittingMs).toBe(34 * MINUTE_MS + 10 * SECOND_MS);
    rerender({ receivedAt: Date.now(), sittingMs: 40 * MINUTE_MS });
    expect(result.current.sittingMs).toBe(40 * MINUTE_MS);
  });
});
