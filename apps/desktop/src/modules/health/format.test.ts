import { createI18n } from '@muna/i18n';
import { describe, expect, it } from 'vitest';

import {
  BREATH_MAX_SCALE,
  BREATH_MIN_SCALE,
  breathPositionAt,
  breathTargetScale,
  breatheCycleMs,
  breatheRhythm,
  clockAt,
  clockRuns,
  formatDuration,
  HOUR_MS,
  MINUTE_MS,
  mindfulMinutes,
  SECOND_MS,
  sliceAt,
} from './format';
import { sampleSnapshot } from './sample-snapshot';

const { t } = createI18n();

describe('health format', () => {
  it('prints whole minutes and hours from the catalog', () => {
    expect(formatDuration(0, t)).toBe('0 min');
    expect(formatDuration(59 * SECOND_MS, t)).toBe('0 min');
    expect(formatDuration(34 * MINUTE_MS + 20 * SECOND_MS, t)).toBe('34 min');
    expect(formatDuration(HOUR_MS, t)).toBe('1 h');
    expect(formatDuration(HOUR_MS + 15 * MINUTE_MS, t)).toBe('1 h 15 min');
    expect(formatDuration(-5, t)).toBe('0 min');
    expect(mindfulMinutes(659)).toBe(10);
  });

  it('slices a flow into equal prompts and stays on the last one at the end', () => {
    expect(sliceAt(0, 180_000, 6)).toBe(0);
    expect(sliceAt(29_999, 180_000, 6)).toBe(0);
    expect(sliceAt(30_000, 180_000, 6)).toBe(1);
    expect(sliceAt(179_999, 180_000, 6)).toBe(5);
    expect(sliceAt(180_000, 180_000, 6)).toBe(5);
    expect(sliceAt(-1, 180_000, 6)).toBe(0);
    expect(sliceAt(10, 0, 6)).toBe(5);
    expect(sliceAt(10, 100, 0)).toBe(0);
  });

  it('knows the two breathing patterns by rhythm and cycle', () => {
    expect(breatheRhythm('box')).toBe('4-4-4-4');
    expect(breatheRhythm('relax')).toBe('4-7-8');
    expect(breatheCycleMs('box')).toBe(16_000);
    expect(breatheCycleMs('relax')).toBe(19_000);
  });

  it('places a moment in the pattern: phase, how far in, and the round', () => {
    const start = breathPositionAt('box', 0, 128_000);
    expect(start).toMatchObject({ index: 0, intoMs: 0, round: 1, rounds: 8 });
    expect(start.phase.kind).toBe('inhale');
    const hold = breathPositionAt('box', 5_500, 128_000);
    expect(hold).toMatchObject({ index: 1, intoMs: 1_500, round: 1 });
    expect(hold.phase.kind).toBe('hold');
    const secondRound = breathPositionAt('box', 16_000 + 12_000, 128_000);
    expect(secondRound).toMatchObject({ index: 3, intoMs: 0, round: 2 });
    const relaxExhale = breathPositionAt('relax', 12_000, 114_000);
    expect(relaxExhale).toMatchObject({ index: 2, intoMs: 1_000, round: 1, rounds: 6 });
    expect(relaxExhale.phase.kind).toBe('exhale');
    // The end of the flow stays in the last round rather than starting a new one.
    expect(breathPositionAt('box', 128_000, 128_000).round).toBe(8);
  });

  it('sizes the circle: full after an inhale, small after an exhale, holds keep the last size', () => {
    expect(breathTargetScale('box', 0)).toBe(BREATH_MAX_SCALE);
    expect(breathTargetScale('box', 1)).toBe(BREATH_MAX_SCALE);
    expect(breathTargetScale('box', 2)).toBe(BREATH_MIN_SCALE);
    expect(breathTargetScale('box', 3)).toBe(BREATH_MIN_SCALE);
    expect(breathTargetScale('relax', 1)).toBe(BREATH_MAX_SCALE);
    expect(breathTargetScale('relax', 2)).toBe(BREATH_MIN_SCALE);
  });

  it('counts the sit up and the reminder and the flow down from the snapshot', () => {
    const sitting = sampleSnapshot();
    expect(clockAt(sitting, 0)).toEqual({
      sittingMs: 34 * MINUTE_MS,
      nextBreakInMs: 16 * MINUTE_MS,
      flowRemainingMs: null,
      flowElapsedMs: null,
    });
    expect(clockAt(sitting, 90 * SECOND_MS)).toMatchObject({
      sittingMs: 34 * MINUTE_MS + 90 * SECOND_MS,
      nextBreakInMs: 16 * MINUTE_MS - 90 * SECOND_MS,
    });
    // Past the reminder the countdown stops at zero; Rust will publish the reminder itself.
    expect(clockAt(sitting, HOUR_MS).nextBreakInMs).toBe(0);
    expect(clockRuns(sitting)).toBe(true);

    const away = sampleSnapshot({ sitting: 'away', nextBreakInMs: null });
    expect(clockAt(away, HOUR_MS)).toMatchObject({
      sittingMs: 34 * MINUTE_MS,
      nextBreakInMs: null,
    });
    expect(clockRuns(away)).toBe(false);

    const flowing = sampleSnapshot({
      sitting: 'away',
      flow: { flow: 'move', startedMs: 0, remainingMs: 100_000, totalMs: 180_000, pattern: 'box' },
    });
    expect(clockAt(flowing, 30_000)).toMatchObject({
      flowRemainingMs: 70_000,
      flowElapsedMs: 110_000,
    });
    expect(clockAt(flowing, 500_000)).toMatchObject({ flowRemainingMs: 0, flowElapsedMs: 180_000 });
    expect(clockRuns(flowing)).toBe(true);
    expect(clockRuns(null)).toBe(false);
  });
});
