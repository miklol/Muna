import { describe, expect, it } from 'vitest';

import {
  budgets,
  buildReport,
  cpuPercent,
  evaluate,
  failedReport,
  median,
  memorySummary,
  morphSummary,
  parseMemoryTargetLine,
  parseMorphLine,
  parseReadyLine,
  percentile,
  planFor,
  renderMarkdown,
} from './report.mjs';

const READY =
  '[2026-09-25][11:48:35][muna_lib::shell::manager][INFO] shell ready label="notch" since_start_ms=771';
const MORPH =
  '[2026-09-25][11:10:37][muna_lib::ipc][INFO] morph label="notch" expanded=false fps=153 frames=61 duration_ms=399 max_frame_ms=22 dropped=0';
const MEMORY_TARGET =
  '[2026-09-25][12:06:52][muna_lib::shell::manager][INFO] webview memory target target=Low windows=2';

describe('log line parsing', () => {
  it('reads the shell ready line', () => {
    expect(parseReadyLine(READY)).toEqual({ label: 'notch', sinceStartMs: 771 });
    expect(parseReadyLine('[INFO] modules running modules=["media"]')).toBeNull();
  });

  it('reads a memory target transition', () => {
    expect(parseMemoryTargetLine(MEMORY_TARGET)).toEqual({ target: 'low', windows: 2 });
    expect(parseMemoryTargetLine(MEMORY_TARGET.replace('Low', 'Normal'))).toEqual({
      target: 'normal',
      windows: 2,
    });
    expect(parseMemoryTargetLine(READY)).toBeNull();
  });

  it('reads a morph report', () => {
    expect(parseMorphLine(MORPH)).toEqual({
      label: 'notch',
      expanded: false,
      fps: 153,
      frames: 61,
      durationMs: 399,
      maxFrameMs: 22,
      dropped: 0,
    });
    expect(parseMorphLine(READY)).toBeNull();
  });
});

describe('statistics', () => {
  it('median and nearest-rank percentile', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
  });

  it('normalises tree CPU time to all logical processors and ignores vanished time', () => {
    const before = [
      { pid: 1, cpuMs: 1000 },
      { pid: 2, cpuMs: 500 },
    ];
    const after = [
      { pid: 1, cpuMs: 1300 }, // +300 ms
      { pid: 3, cpuMs: 100 }, // appeared: counts from zero
    ];
    const cpu = cpuPercent(before, after, 10_000, 4);
    expect(cpu.raw).toBeCloseTo(4, 5); // 400 ms of one core over 10 s
    expect(cpu.normalised).toBeCloseTo(1, 5);
    expect(cpuPercent(before, after, 0, 4)).toEqual({ normalised: null, raw: null });
  });

  it('summarises memory samples and morphs', () => {
    expect(memorySummary([])).toBeNull();
    expect(
      memorySummary([{ privateWorkingSetMb: 131.56 }, { privateWorkingSetMb: 126.31 }]),
    ).toEqual({
      final: 126.3,
      min: 126.3,
      median: 128.9,
      max: 131.6,
      samples: 2,
      idle: 126.3,
      trimmed: false,
      normal: { final: 126.3, min: 126.3, median: 128.9, max: 131.6, samples: 2 },
      low: null,
    });
    const morphs = [
      { expanded: true, fps: 60, durationMs: 400, maxFrameMs: 17, dropped: 0 },
      { expanded: false, fps: 58, durationMs: 300, maxFrameMs: 33, dropped: 1 },
      { expanded: true, fps: 62, durationMs: 420, maxFrameMs: 16, dropped: 0 },
    ];
    expect(morphSummary(morphs)).toEqual({
      count: 3,
      minFps: 58,
      medianFps: 60,
      maxFrameMs: 33,
      droppedFrames: 1,
      expand: { count: 2, medianDurationMs: 410, minFps: 60 },
      collapse: { count: 1, medianDurationMs: 300, minFps: 58 },
    });
    expect(morphSummary([])).toBeNull();
  });

  it('gates memory on the median of the samples taken at the low target once the trim ran', () => {
    const summary = memorySummary([
      { privateWorkingSetMb: 118.5, memoryTarget: 'normal' },
      { privateWorkingSetMb: 123.0, memoryTarget: 'normal' },
      { privateWorkingSetMb: 86.5, memoryTarget: 'low' },
      { privateWorkingSetMb: 19.6, memoryTarget: 'low' },
      { privateWorkingSetMb: 28.4, memoryTarget: 'low' },
      { privateWorkingSetMb: 35.0, memoryTarget: 'low' },
    ]);
    expect(summary).toMatchObject({
      final: 35,
      idle: 31.7,
      trimmed: true,
      normal: { median: 120.8, max: 123, samples: 2 },
      low: { min: 19.6, max: 86.5, median: 31.7, samples: 4 },
    });
  });
});

describe('plans and budgets', () => {
  it('smoke waits 5 s, samples CPU 30 s and memory past the idle trim; full uses the docs/09 windows and drives morphs', () => {
    expect(planFor('smoke')).toMatchObject({
      warmupSeconds: 5,
      cpuSeconds: 30,
      memoryAfterSeconds: 90,
      morphs: 0,
    });
    expect(planFor('full')).toMatchObject({
      warmupSeconds: 30,
      cpuSeconds: 60,
      memoryAfterSeconds: 300,
      morphs: 20,
    });
  });

  it('keeps the PRD budgets', () => {
    expect(budgets.startupMs.max).toBe(1500);
    expect(budgets.idleCpuPercent.max).toBe(0.3);
    expect(budgets.privateWorkingSetMb.max).toBe(120);
    expect(budgets.morphFpsMin.min).toBe(58);
  });

  it('passes within budget, fails on a breach, skips fps in smoke and misses it in full', () => {
    const within = {
      startupMs: 521,
      idleCpuPercent: 0.003,
      privateWorkingSetMb: 118.2,
      morphFpsMin: null,
    };
    const smoke = evaluate(within, planFor('smoke'));
    expect(smoke.pass).toBe(true);
    expect(smoke.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'skipped']);

    const full = evaluate(within, planFor('full'));
    expect(full.pass).toBe(false);
    expect(full.failed).toEqual(['morphFpsMin']);
    expect(full.checks.find((c) => c.metric === 'morphFpsMin')?.status).toBe('missing');

    const breach = evaluate(
      { ...within, privateWorkingSetMb: 126.3, morphFpsMin: 57 },
      planFor('full'),
    );
    expect(breach.failed).toEqual(['privateWorkingSetMb', 'morphFpsMin']);
    expect(breach.checks.find((c) => c.metric === 'startupMs')?.status).toBe('pass');
  });
});

describe('reports', () => {
  const host = { os: 'Windows 11 Pro 10.0.26200', logicalProcessors: 32, memoryGb: 15.7 };
  const exe = { path: 'apps/desktop/src-tauri/target/debug/muna.exe', profile: 'debug' };
  const results = {
    startupMs: 521,
    sinceMainMs: 511,
    cpu: { normalised: 0.0028, raw: 0.09 },
    memorySamples: [{ privateWorkingSetMb: 131.5 }, { privateWorkingSetMb: 118.24 }],
    workingSetMb: 475.1,
    processes: 7,
    morphs: [],
  };

  it('builds a measured report and renders the PR comment with the marker', () => {
    const report = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results,
      notes: ['Debug build.'],
      generatedAt: '2026-09-25T11:48:35.000Z',
    });
    expect(report.status).toBe('measured');
    expect(report.measurements).toMatchObject({
      startupMs: 521,
      idleCpuPercent: 0.0028,
      privateWorkingSetMb: 118.2,
      privateWorkingSetBeforeTrimMb: 124.9,
      memoryTrimObserved: false,
      morphFpsMin: null,
    });
    expect(report.evaluation.pass).toBe(true);

    const markdown = renderMarkdown(report);
    expect(markdown.startsWith('### Perf smoke — pass')).toBe(true);
    expect(markdown).toContain(
      '| Cold start to first strip paint | 521 ms | ≤ 1500 ms | — | pass |',
    );
    expect(markdown).toContain('| Slowest strip ↔ panel morph | — | ≥ 58 fps | — | nightly |');
    expect(markdown).toContain('idle memory trim not observed');
    expect(markdown).toContain('- Debug build.');
    expect(markdown).toContain('no baseline');
    expect(markdown.trimEnd().endsWith('<!-- muna-perf-report -->')).toBe(true);
  });

  it('reports the first launch of a new binary as a detail without gating it', () => {
    const report = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: { ...results, firstLaunchMs: 4157 },
    });
    expect(report.measurements.firstLaunchMs).toBe(4157);
    expect(report.evaluation.pass).toBe(true);
    expect(report.evaluation.checks.map((c) => c.metric)).not.toContain('firstLaunchMs');
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('first launch of this binary 4157 ms (not gated)');
    expect(markdown).toContain(
      '| Cold start to first strip paint | 521 ms | ≤ 1500 ms | — | pass |',
    );

    const without = buildReport({ mode: 'smoke', plan: planFor('smoke'), exe, host, results });
    expect(without.measurements.firstLaunchMs).toBeNull();
    expect(renderMarkdown(without)).not.toContain('first launch of this binary');
  });

  it('reports the trimmed idle memory and keeps the pre-trim number in the details', () => {
    const report = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: {
        ...results,
        memorySamples: [
          { privateWorkingSetMb: 118.5, memoryTarget: 'normal' },
          { privateWorkingSetMb: 123.0, memoryTarget: 'normal' },
          { privateWorkingSetMb: 28.4, memoryTarget: 'low' },
          { privateWorkingSetMb: 35.0, memoryTarget: 'low' },
        ],
      },
    });
    expect(report.measurements).toMatchObject({
      privateWorkingSetMb: 31.7,
      privateWorkingSetBeforeTrimMb: 120.8,
      memoryTrimObserved: true,
    });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain(
      '| Private working set of the process tree, idle | 31.7 MB | ≤ 120 MB | — | pass |',
    );
    expect(markdown).toContain('120.8 MB private before the idle trim');
  });

  it('shows deltas against a baseline and flags a breach', () => {
    const plan = planFor('smoke');
    const baseline = buildReport({
      mode: 'smoke',
      plan,
      exe,
      host,
      results,
      generatedAt: 'earlier',
    });
    const worse = buildReport({
      mode: 'smoke',
      plan,
      exe,
      host,
      results: { ...results, startupMs: 1700, memorySamples: [{ privateWorkingSetMb: 121 }] },
    });
    const markdown = renderMarkdown(worse, baseline);
    expect(markdown.startsWith('### Perf smoke — fail')).toBe(true);
    expect(markdown).toContain('| 1700 ms | ≤ 1500 ms | +1179 ms | **fail** |');
    expect(markdown).toContain('| 121 MB | ≤ 120 MB | +2.8 MB | **fail** |');
    expect(markdown).toContain('baseline: earlier');
  });

  it('renders a failed run with its error and the marker', () => {
    const report = failedReport({
      mode: 'full',
      plan: planFor('full'),
      exe,
      host: null,
      error: 'Binary missing.',
    });
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('### Perf full — not run');
    expect(markdown).toContain('Binary missing.');
    expect(markdown).toContain('<!-- muna-perf-report -->');
    expect(report.evaluation.pass).toBe(false);
  });
});
