import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MunaMotionProvider } from '../motion/reduced-motion';
import { ringArcs, SegmentedRing, segmentColor } from './segmented-ring';

const segments = [
  { id: 'browsing', value: 30, tint: 'blue' },
  { id: 'development', value: 60, tint: 'purple' },
  { id: 'other', value: 10, tint: 'neutral' },
] as const;

describe('ringArcs', () => {
  it('lays the shares clockwise from 12 o’clock with a gap between neighbours', () => {
    // Circumference 200 px and a 2 px gap: each gap is 0.01 of the ring.
    const arcs = ringArcs(segments, 200);
    expect(arcs.map((arc) => arc.id)).toEqual(['browsing', 'development', 'other']);
    expect(arcs[0]).toMatchObject({ start: 0.005, tint: 'blue' });
    expect(arcs[0]?.length).toBeCloseTo(0.29);
    expect(arcs[1]?.start).toBeCloseTo(0.305);
    expect(arcs[1]?.length).toBeCloseTo(0.59);
    expect(arcs[2]?.start).toBeCloseTo(0.905);
    expect(arcs[2]?.length).toBeCloseTo(0.09);
    // Gaps and arcs together close the circle.
    const covered = arcs.reduce((sum, arc) => sum + arc.length, 0) + 3 * 0.01;
    expect(covered).toBeCloseTo(1);
  });

  it('skips empty segments and closes the circle for a lone one', () => {
    expect(ringArcs([{ id: 'a', value: 0, tint: 'blue' }], 200)).toEqual([]);
    expect(ringArcs([], 200)).toEqual([]);
    expect(
      ringArcs(
        [
          { id: 'a', value: 5, tint: 'green' },
          { id: 'b', value: 0, tint: 'blue' },
        ],
        200,
      ),
    ).toEqual([{ id: 'a', start: 0, length: 1, tint: 'green' }]);
  });

  it('collapses a segment thinner than its gap instead of drawing a dot', () => {
    const arcs = ringArcs(
      [
        { id: 'big', value: 999, tint: 'blue' },
        { id: 'sliver', value: 1, tint: 'orange' },
      ],
      200,
    );
    expect(arcs[1]?.length).toBe(0);
  });

  it('maps the neutral tint to the tertiary text colour', () => {
    expect(segmentColor('neutral')).toBe('var(--text-3)');
    expect(segmentColor('cyan')).toBe('var(--accent-cyan)');
    expect(segmentColor('accent')).toBe('var(--accent)');
  });
});

describe('SegmentedRing', () => {
  it('is a labelled image sized by the diameter with one arc per non-empty segment', () => {
    render(<SegmentedRing aria-label="Time by category" diameter={96} segments={segments} />);
    const ring = screen.getByRole('img', { name: 'Time by category' });
    expect(ring.style.inlineSize).toBe('96px');
    expect(ring).not.toHaveAttribute('data-empty');
    const arcs = ring.querySelectorAll('.muna-segmented-ring__segment');
    expect(arcs).toHaveLength(3);
    // 8 px stroke: r = (96 - 8) / 2
    expect(arcs[0]).toHaveAttribute('r', '44');
    expect((arcs[0] as SVGElement).style.getPropertyValue('--muna-tint')).toBe(
      'var(--accent-blue)',
    );
    expect((arcs[2] as SVGElement).style.getPropertyValue('--muna-tint')).toBe('var(--text-3)');
  });

  it('shows only the track when there is nothing to share out', () => {
    render(
      <SegmentedRing aria-label="Time by category" diameter={64} size="small" segments={[]} />,
    );
    const ring = screen.getByRole('img', { name: 'Time by category' });
    expect(ring).toHaveAttribute('data-empty');
    expect(ring.querySelectorAll('.muna-segmented-ring__segment')).toHaveLength(0);
    expect(ring.querySelector('.muna-segmented-ring__track')).toHaveAttribute('stroke-width', '6');
  });

  it('renders centre content and works under reduced motion', () => {
    render(
      <MunaMotionProvider reduceMotion>
        <SegmentedRing aria-label="Time by category" diameter={80} segments={segments}>
          1 h 40 min
        </SegmentedRing>
      </MunaMotionProvider>,
    );
    expect(screen.getByText('1 h 40 min')).toHaveClass('muna-segmented-ring__content');
  });
});
