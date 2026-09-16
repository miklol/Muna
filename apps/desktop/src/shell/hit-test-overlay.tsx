import type { MorphReport, ShapeRect } from '@muna/contracts';

import type { ShellState } from './machine';

export interface HitTestOverlayProps {
  /** The rects last handed to the shell's hit tester (first = strip). */
  rects: readonly ShapeRect[];
  state: ShellState;
  /** Frame statistics of the last morph, if any. */
  morph: MorphReport | null;
}

/** Dev builds only, and only when `VITE_MUNA_HIT_TEST=1` (`scripts/dev.ps1 -HitTest`). */
export const hitTestOverlayEnabled: boolean =
  import.meta.env.DEV && import.meta.env.VITE_MUNA_HIT_TEST === '1';

const fps = (report: MorphReport): string => {
  if (report.frames < 2 || report.durationUs <= 0) {
    return '–';
  }
  return ((report.frames - 1) / (report.durationUs / 1_000_000)).toFixed(0);
};

/**
 * Debug overlay for the hit-test rects and the morph frame rate. Static DOM, no timers: it
 * re-renders only when the rects or the last morph report change.
 */
export function HitTestOverlay({ rects, state, morph }: HitTestOverlayProps) {
  return (
    <div aria-hidden="true" data-testid="hit-test-overlay" className="pointer-events-none">
      {rects.map((rect, index) => (
        <div
          key={`${String(index)}-${String(rect.x)}-${String(rect.y)}`}
          className="absolute border border-dashed"
          style={{
            left: rect.x,
            top: rect.y,
            width: rect.width,
            height: rect.height,
            borderColor: index === 0 ? 'var(--accent-cyan)' : 'var(--accent-orange)',
          }}
        />
      ))}
      <div className="absolute top-2 left-2 rounded-control bg-notch-black px-2 py-1 text-caption text-text-2 tabular-nums">
        {state}
        {morph !== null && (
          <>
            {' · '}
            {morph.expanded ? 'expand' : 'collapse'} {fps(morph)} fps · {morph.frames} frames ·{' '}
            {(morph.durationUs / 1000).toFixed(0)} ms · max {(morph.maxFrameUs / 1000).toFixed(1)}{' '}
            ms · dropped {morph.droppedFrames}
          </>
        )}
      </div>
    </div>
  );
}
