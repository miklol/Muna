import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { timings } from '../motion/presets';
import { MunaMotionProvider } from '../motion/reduced-motion';
import { barScale, syntheticSample, Waveform, waveformAmplitude, waveformRest } from './waveform';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Waveform', () => {
  it('keeps the synthetic magnitude within 0–1 and deterministic', () => {
    for (let t = 0; t < 5_000; t += 37) {
      for (let bar = 0; bar < 4; bar += 1) {
        const value = syntheticSample(bar, t);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(syntheticSample(bar, t)).toBe(value);
      }
    }
  });

  it('scales bars between 4 and 20 px of a 20 px box', () => {
    expect(barScale(0, 20)).toBeCloseTo(waveformAmplitude.min / 20);
    expect(barScale(1, 20)).toBeCloseTo(waveformAmplitude.max / 20);
    expect(barScale(1, 16)).toBe(1);
    expect(waveformRest).toHaveLength(4);
  });

  it('renders four decorative bars in the media tint by default', () => {
    const { container } = render(<Waveform playing={false} />);
    const root = container.querySelector('.muna-waveform');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root).toHaveStyle({ '--muna-tint': 'var(--accent-cyan)' });
    expect(container.querySelectorAll('.muna-waveform__bar')).toHaveLength(4);
  });

  it('samples at 30 Hz only while playing', () => {
    const sample = vi.fn(() => 0.5);
    const { rerender } = render(<Waveform playing={false} sample={sample} />);
    vi.advanceTimersByTime(1_000);
    expect(sample).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    rerender(<Waveform playing sample={sample} />);
    expect(vi.getTimerCount()).toBe(1);
    sample.mockClear();
    vi.advanceTimersByTime(1_000);
    // Four bars per tick, `waveformSampleHz` ticks per second (±1 for interval rounding).
    expect(sample.mock.calls.length / 4).toBeGreaterThanOrEqual(timings.waveformSampleHz - 1);
    expect(sample.mock.calls.length / 4).toBeLessThanOrEqual(timings.waveformSampleHz + 1);

    rerender(<Waveform playing={false} sample={sample} />);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('freezes under reduced motion and while the document is hidden', () => {
    const sample = vi.fn(() => 0.5);
    const { unmount } = render(
      <MunaMotionProvider reduceMotion>
        <Waveform playing sample={sample} />
      </MunaMotionProvider>,
    );
    vi.advanceTimersByTime(500);
    expect(sample).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    unmount();

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('visible');
    const { unmount: unmountPlaying } = render(<Waveform playing sample={sample} />);
    expect(vi.getTimerCount()).toBe(1);

    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(0);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(1);

    unmountPlaying();
    expect(vi.getTimerCount()).toBe(0);
    visibility.mockRestore();
  });
});
