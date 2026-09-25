import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MunaMotionProvider } from '../motion/reduced-motion';
import { Marquee, marqueeTimeline, overflows } from './marquee';

const fits = () => ({ container: 200, content: 120 });
const overflowing = () => ({ container: 200, content: 320 });

describe('Marquee', () => {
  it('scrolls only when the content is wider than its box', () => {
    expect(overflows(200, 320)).toBe(true);
    expect(overflows(200, 200)).toBe(false);
    expect(overflows(200, 120)).toBe(false);
    expect(overflows(0, 120)).toBe(false);
  });

  it('times one loop as wait, 40 px/s scroll, pause', () => {
    const { durationS, times } = marqueeTimeline(400);
    expect(durationS).toBeCloseTo(1.5 + 10 + 1.5);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeCloseTo(1.5 / 13);
    expect(times[2]).toBeCloseTo(11.5 / 13);
    expect(times[3]).toBe(1);
  });

  it('leaves fitting text alone', () => {
    const { container } = render(<Marquee measure={fits}>Short title</Marquee>);
    const root = container.querySelector('.muna-marquee');
    expect(root).not.toHaveAttribute('data-scrolling');
    expect(root).not.toHaveAttribute('data-overflow');
    expect(screen.getAllByText('Short title')).toHaveLength(1);
  });

  it('repeats overflowing text once, hidden from assistive tech', () => {
    const { container } = render(<Marquee measure={overflowing}>A very long title</Marquee>);
    const root = container.querySelector('.muna-marquee');
    expect(root).toHaveAttribute('data-scrolling', 'true');
    const copies = container.querySelectorAll('.muna-marquee__copy');
    expect(copies).toHaveLength(2);
    expect(copies[1]).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('A very long title', { ignore: '[aria-hidden]' })).toBeInTheDocument();
  });

  it('clips instead of scrolling under reduced motion', () => {
    const { container } = render(
      <MunaMotionProvider reduceMotion>
        <Marquee measure={overflowing}>A very long title</Marquee>
      </MunaMotionProvider>,
    );
    const root = container.querySelector('.muna-marquee');
    expect(root).toHaveAttribute('data-overflow', 'true');
    expect(root).not.toHaveAttribute('data-scrolling');
    expect(container.querySelectorAll('.muna-marquee__copy')).toHaveLength(1);
  });
});
