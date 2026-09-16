import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timings } from '../motion/presets';
import { formatCountdown, remainingNow, TimerText } from './timer-text';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TimerText', () => {
  it('formats minutes and hours and never goes negative', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(59_400)).toBe('0:59');
    expect(formatCountdown(25 * 60_000)).toBe('25:00');
    expect(formatCountdown(3_661_000)).toBe('1:01:01');
    expect(formatCountdown(-5_000)).toBe('0:00');
  });

  it('counts from the published value and time', () => {
    expect(remainingNow(60_000, true, 1_000, 11_000)).toBe(50_000);
    expect(remainingNow(60_000, false, 1_000, 11_000)).toBe(60_000);
    expect(remainingNow(5_000, true, 0, 9_000)).toBe(0);
  });

  it('ticks once a second while running and stops when paused', () => {
    let now = 100_000;
    const clock = () => now;
    const { rerender } = render(
      <TimerText remainingMs={90_000} running receivedAt={100_000} now={clock} />,
    );
    expect(screen.getByText('1:30')).toBeInTheDocument();

    now += timings.progressStepMs;
    act(() => {
      vi.advanceTimersByTime(timings.progressStepMs);
    });
    expect(screen.getByText('1:29')).toBeInTheDocument();

    rerender(<TimerText remainingMs={80_000} running={false} receivedAt={now} now={clock} />);
    expect(screen.getByText('1:20')).toBeInTheDocument();
    now += 5 * timings.progressStepMs;
    act(() => {
      vi.advanceTimersByTime(5 * timings.progressStepMs);
    });
    expect(screen.getByText('1:20')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears its interval on unmount', () => {
    const { unmount } = render(<TimerText remainingMs={90_000} running receivedAt={Date.now()} />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
