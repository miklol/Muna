import { describe, expect, it, vi } from 'vitest';

import { describeStall, driveMorphs } from './harness.mjs';
import {
  budgets,
  buildReport,
  cpuPercent,
  cpuWindows,
  evaluate,
  failedReport,
  idleCpuSummary,
  median,
  memorySummary,
  morphSummary,
  parseMemoryTargetLine,
  parseMorphLine,
  parseReadyLine,
  percentile,
  planFor,
  renderMarkdown,
  renderStallLog,
  startupBreakdown,
  STRIP_PROBE_DEPTH_PX,
  stripProbePoint,
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

  /** Smoke-shaped idle samples (5 s apart from 5 s to 90 s) with the given per-window CPU ms. */
  const idleSamples = (windowCpuMs, { logicalProcessors = 4 } = {}) => {
    const samples = [{ atSeconds: 5, wallMs: 1000, processes: [{ pid: 1, cpuMs: 0 }] }];
    let cpuMs = 0;
    windowCpuMs.forEach((ms, i) => {
      cpuMs += ms;
      samples.push({
        atSeconds: 10 + 5 * i,
        wallMs: 1000 + 5000 * (i + 1),
        processes: [{ pid: 1, cpuMs }],
      });
    });
    return { samples, logicalProcessors };
  };

  it('turns consecutive idle samples into CPU windows on the measured wall time', () => {
    const windows = cpuWindows(
      [
        { atSeconds: 5, wallMs: 1000, processes: [{ pid: 1, cpuMs: 100 }] },
        { atSeconds: 10, wallMs: 6250, processes: [{ pid: 1, cpuMs: 205 }] }, // 105 ms / 5.25 s
        {
          atSeconds: 15,
          wallMs: 11_250,
          processes: [
            { pid: 1, cpuMs: 205 },
            { pid: 2, cpuMs: 50 }, // appeared: counts from zero
          ],
        },
      ],
      4,
    );
    expect(windows).toHaveLength(2);
    expect(windows[0]).toMatchObject({ fromSeconds: 5, toSeconds: 10, wallMs: 5250 });
    expect(windows[0].raw).toBeCloseTo(2, 5);
    expect(windows[0].normalised).toBeCloseTo(0.5, 5);
    expect(windows[1]).toMatchObject({ fromSeconds: 10, toSeconds: 15, wallMs: 5000 });
    expect(windows[1].raw).toBeCloseTo(1, 5);
    expect(cpuWindows([], 4)).toEqual([]);
  });

  it('gates idle CPU on the median steady-state window and reports the settling phase', () => {
    // 17 windows: the trim-era settling phase is busy (50 ms per 5 s = 1 % of one core), the
    // steady state sits at 15 ms (0.3 % of one core) with one busy window in it.
    const perWindow = [50, 50, 50, 50, 50, 50, 30, 20, 15, 15, 15, 15, 15, 150, 15, 15, 15];
    const { samples, logicalProcessors } = idleSamples(perWindow);
    const plan = planFor('smoke');
    const summary = idleCpuSummary(cpuWindows(samples, logicalProcessors), plan);
    expect(summary.windowSeconds).toBe(5);
    expect(summary.windows).toHaveLength(17);
    expect(summary.overlap).toBe(false);
    expect(summary.steadyState).toMatchObject({ fromSeconds: 60, toSeconds: 90, windows: 6 });
    expect(summary.steadyState.median.raw).toBeCloseTo(0.3, 5);
    expect(summary.steadyState.median.normalised).toBeCloseTo(0.075, 5);
    expect(summary.steadyState.mean.raw).toBeCloseTo((15 * 5 + 150) / 6 / 50, 5);
    expect(summary.steadyState.max.raw).toBeCloseTo(3, 5);
    expect(summary.settling).toMatchObject({ fromSeconds: 5, toSeconds: 35, windows: 6 });
    expect(summary.settling.mean.raw).toBeCloseTo(1, 5);
    expect(summary.settling.median.normalised).toBeCloseTo(0.25, 5);
  });

  it('idle CPU summary copes with short runs and nothing measured', () => {
    expect(idleCpuSummary([], planFor('smoke'))).toBeNull();
    const unmeasured = [{ fromSeconds: 5, toSeconds: 10, wallMs: 0, normalised: null, raw: null }];
    expect(idleCpuSummary(unmeasured, planFor('smoke'))).toBeNull();
    // Two windows only: both phases take what falls inside them and overlap is flagged.
    const { samples, logicalProcessors } = idleSamples([20, 10]);
    const short = idleCpuSummary(cpuWindows(samples, logicalProcessors), planFor('smoke'));
    expect(short.steadyState).toMatchObject({ fromSeconds: 5, toSeconds: 15, windows: 2 });
    expect(short.settling).toMatchObject({ fromSeconds: 5, toSeconds: 15, windows: 2 });
    expect(short.overlap).toBe(true);
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

  it('drives morphs through the top sliver, inside the strip whether it rests or peeks', () => {
    // A 1680 × 720 physical notch window at 150 % on a 2560-wide display (the dev machine) and
    // the runner's 1000 × 440 window at 100 %. The shell keeps PEEK_HEIGHT_PX = 6 logical px of
    // the strip on screen while it peeks under a maximised window's caption.
    const peekSliverPx = 6;
    const stripHeightPx = 32;
    for (const window of [
      { left: 440, top: 0, right: 2120, bottom: 720, dpi: 144 },
      { left: 12, top: 0, right: 1012, bottom: 440, dpi: 96 },
    ]) {
      const scale = window.dpi / 96;
      const point = stripProbePoint(window);
      expect(point.x).toBe((window.left + window.right) / 2);
      expect(point.y).toBeGreaterThan(window.top);
      expect(point.y).toBeLessThan(window.top + peekSliverPx * scale);
      expect(point.y).toBeLessThan(window.top + stripHeightPx * scale);
    }
    expect(STRIP_PROBE_DEPTH_PX).toBe(3);
    expect(stripProbePoint({ left: 440, top: 0, right: 2120, bottom: 720, dpi: 144 })).toEqual({
      x: 1280,
      y: 4.5,
    });
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
  it('smoke waits 5 s, gates CPU on the last 30 s of a 90 s idle phase; full uses the docs/09 windows and drives morphs', () => {
    expect(planFor('smoke')).toMatchObject({
      warmupSeconds: 5,
      cpuSeconds: 30,
      memoryAfterSeconds: 90,
      memorySampleSeconds: 5,
      morphs: 0,
    });
    expect(planFor('full')).toMatchObject({
      warmupSeconds: 30,
      cpuSeconds: 60,
      memoryAfterSeconds: 300,
      memorySampleSeconds: 10,
      morphs: 20,
    });
  });

  it('keeps the settling phase and the gated steady state apart in both plans', () => {
    for (const mode of ['smoke', 'full']) {
      const plan = planFor(mode);
      expect(plan.memoryAfterSeconds - plan.warmupSeconds).toBeGreaterThanOrEqual(
        2 * plan.cpuSeconds,
      );
      expect(plan.cpuSeconds % plan.memorySampleSeconds).toBe(0);
    }
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

  it('gates the start-up on release builds only and reports it for a debug build', () => {
    const slow = {
      startupMs: 1976,
      idleCpuPercent: 0.073,
      privateWorkingSetMb: 30,
      morphFpsMin: null,
    };
    const release = evaluate(slow, planFor('smoke'), budgets, 'release');
    expect(release.pass).toBe(false);
    expect(release.failed).toEqual(['startupMs']);

    const debug = evaluate(slow, planFor('smoke'), budgets, 'debug');
    expect(debug.pass).toBe(true);
    expect(debug.failed).toEqual([]);
    expect(debug.checks.find((c) => c.metric === 'startupMs')?.status).toBe('informational-over');
    expect(
      evaluate({ ...slow, startupMs: 1474 }, planFor('smoke'), budgets, 'debug').checks[0].status,
    ).toBe('informational');

    // CPU and memory of a debug build are upper bounds and still gate.
    const hot = evaluate({ ...slow, idleCpuPercent: 0.4 }, planFor('smoke'), budgets, 'debug');
    expect(hot.failed).toEqual(['idleCpuPercent']);
  });
});

describe('reports', () => {
  const host = { os: 'Windows 11 Pro 10.0.26200', logicalProcessors: 32, memoryGb: 15.7 };
  const exe = { path: 'apps/desktop/src-tauri/target/debug/muna.exe', profile: 'debug' };
  const phase = (fromSeconds, toSeconds, windows, { median, mean, max }) => ({
    fromSeconds,
    toSeconds,
    windows,
    median: { normalised: median / 32, raw: median },
    mean: { normalised: mean / 32, raw: mean },
    max: { normalised: max / 32, raw: max },
  });
  const idleCpu = {
    windowSeconds: 5,
    steadyState: phase(60, 90, 6, { median: 0.09, mean: 0.11, max: 0.2 }),
    settling: phase(5, 35, 6, { median: 0.8, mean: 0.9, max: 1.3 }),
    overlap: false,
    windows: [],
  };
  const results = {
    startupMs: 521,
    sinceMainMs: 511,
    idleCpu,
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
      idleCpuRawPercent: 0.09,
      idleCpuMeanPercent: 0.0034,
      idleCpuMaxPercent: 0.0063,
      settlingCpuPercent: 0.0281,
      privateWorkingSetMb: 118.2,
      privateWorkingSetBeforeTrimMb: 124.9,
      memoryTrimObserved: false,
      morphFpsMin: null,
    });
    expect(report.idleCpu).toBe(idleCpu);
    expect(report.evaluation.pass).toBe(true);

    const markdown = renderMarkdown(report);
    expect(markdown.startsWith('### Perf smoke — pass')).toBe(true);
    expect(markdown).toContain(
      '| Cold start to first strip paint | 521 ms | ≤ 1500 ms | — | reported (debug build) |',
    );
    expect(markdown).toContain(
      '| Idle CPU at steady state, whole process tree, normalised to all logical processors | 0.003 % | ≤ 0.3 % | — | pass |',
    );
    expect(markdown).toContain(
      'idle CPU 0.09 % of one core (median of 6 × 5 s windows over 60–90 s; mean 0.11 %, busiest window 0.2 %), settling 0.9 % over 5–35 s (not gated)',
    );
    expect(markdown).toContain('| Slowest strip ↔ panel morph | — | ≥ 58 fps | — | nightly |');
    expect(markdown).toContain('idle memory trim not observed');
    expect(markdown).toContain('- Debug build.');
    expect(markdown).toContain('no baseline');
    expect(markdown).not.toContain('predates the steady-state');
    expect(markdown.trimEnd().endsWith('<!-- muna-perf-report -->')).toBe(true);
  });

  it('gates the steady-state median, not the settling phase', () => {
    const busyStart = {
      ...idleCpu,
      steadyState: phase(60, 90, 6, { median: 0.3, mean: 0.5, max: 1.6 }),
      settling: phase(5, 35, 6, { median: 10, mean: 12, max: 20 }),
    };
    const report = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: { ...results, idleCpu: busyStart },
    });
    expect(report.measurements.idleCpuPercent).toBeCloseTo(0.3 / 32, 4);
    expect(report.measurements.settlingCpuPercent).toBeCloseTo(12 / 32, 4);
    expect(report.evaluation.pass).toBe(true);

    const over = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: {
        ...results,
        idleCpu: { ...idleCpu, steadyState: phase(60, 90, 6, { median: 12, mean: 12, max: 12 }) },
      },
    });
    expect(over.evaluation.failed).toEqual(['idleCpuPercent']);
  });

  it('flags a baseline that predates the steady-state method and still accepts the old results shape', () => {
    const legacy = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: { ...results, idleCpu: undefined, cpu: { normalised: 0.0315, raw: 1.008 } },
      generatedAt: '2026-10-03T10:00:00.000Z',
    });
    expect(legacy.idleCpu).toBeNull();
    expect(legacy.measurements.idleCpuPercent).toBe(0.0315);
    expect(legacy.measurements.settlingCpuPercent).toBeNull();
    expect(renderMarkdown(legacy)).toContain('idle CPU 1.01 % of one core ·');

    const report = buildReport({ mode: 'smoke', plan: planFor('smoke'), exe, host, results });
    const markdown = renderMarkdown(report, legacy);
    expect(markdown).toContain('| 0.003 % | ≤ 0.3 % | -0.029 % | pass |');
    expect(markdown).toContain('predates the steady-state idle CPU method');
    expect(renderMarkdown(report, report)).not.toContain('predates the steady-state');
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
      '| Cold start to first strip paint | 521 ms | ≤ 1500 ms | — | reported (debug build) |',
    );

    const without = buildReport({ mode: 'smoke', plan: planFor('smoke'), exe, host, results });
    expect(without.measurements.firstLaunchMs).toBeNull();
    expect(renderMarkdown(without)).not.toContain('first launch of this binary');
  });

  it('dates the WebView2 browser and first renderer from the process tree and lists them as details', () => {
    const tree = [
      { pid: 100, name: 'muna.exe', kind: 'muna', startedAtMs: 1_000 },
      { pid: 101, name: 'msedgewebview2.exe', kind: 'browser', startedAtMs: 1_412 },
      { pid: 102, name: 'msedgewebview2.exe', kind: 'crashpad', startedAtMs: 1_430 },
      { pid: 103, name: 'msedgewebview2.exe', kind: 'renderer', startedAtMs: 1_690 },
      { pid: 104, name: 'msedgewebview2.exe', kind: 'renderer', startedAtMs: 1_655 },
      { pid: 105, name: 'msedgewebview2.exe', kind: 'utility:network', startedAtMs: null },
    ];
    expect(startupBreakdown(tree, 100)).toEqual({
      webviewBrowserAtMs: 412,
      firstRendererAtMs: 655,
    });
    expect(startupBreakdown(tree.slice(0, 1), 100)).toEqual({
      webviewBrowserAtMs: null,
      firstRendererAtMs: null,
    });
    expect(startupBreakdown(tree, 999)).toEqual({
      webviewBrowserAtMs: null,
      firstRendererAtMs: null,
    });

    const report = buildReport({
      mode: 'smoke',
      plan: planFor('smoke'),
      exe,
      host,
      results: { ...results, ...startupBreakdown(tree, 100) },
    });
    expect(report.measurements).toMatchObject({ webviewBrowserAtMs: 412, firstRendererAtMs: 655 });
    expect(report.evaluation.checks.map((c) => c.metric)).not.toContain('webviewBrowserAtMs');
    const markdown = renderMarkdown(report);
    expect(markdown).toContain('WebView2 browser process created 412 ms after the app');
    expect(markdown).toContain('first renderer 655 ms after the app');
    expect(
      renderMarkdown(buildReport({ mode: 'smoke', plan: planFor('smoke'), exe, host, results })),
    ).not.toContain('WebView2 browser process');
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
    expect(markdown).toContain(
      '| 1700 ms | ≤ 1500 ms | +1179 ms | **over budget**, reported (debug build) |',
    );
    expect(markdown).toContain('| 121 MB | ≤ 120 MB | +2.8 MB | **fail** |');
    expect(markdown).toContain('baseline: earlier');
    expect(worse.evaluation.failed).toEqual(['privateWorkingSetMb']);

    const release = buildReport({
      mode: 'smoke',
      plan,
      exe: { ...exe, path: 'apps/desktop/src-tauri/target/release/muna.exe', profile: 'release' },
      host,
      results: { ...results, startupMs: 1700 },
    });
    expect(release.evaluation.failed).toEqual(['startupMs']);
    expect(renderMarkdown(release, baseline)).toContain(
      '| 1700 ms | ≤ 1500 ms | +1179 ms | **fail** |',
    );
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

  it('keeps a morph stall snapshot in the JSON and folds its shell log into the markdown', () => {
    const stall = {
      phase: 'expand',
      mover: 'cursor',
      error: 'no matching morph within 6000 ms',
      requested: { x: 512, y: 3 },
      lastMove: { ok: true, x: 512, y: 3 },
      cursor: { ok: true, x: 512, y: 3 },
      under: { hwnd: 1, className: 'MunaNotch', pid: 7, processName: 'muna', clickThrough: false },
      foreground: { hwnd: 0, className: '', pid: 0 },
      windows: [],
      memoryTarget: 'low',
      morphsSoFar: 0,
      recentLog: [
        { atMs: 1000, line: READY },
        { atMs: 60000, line: MEMORY_TARGET },
      ],
    };
    const report = buildReport({ mode: 'full', plan: planFor('full'), exe, host, results });
    expect(report.morphStall).toBeNull();
    expect(renderMarkdown(report)).not.toContain('<details>');

    const stalled = buildReport({
      mode: 'full',
      plan: planFor('full'),
      exe,
      host,
      results: { ...results, morphStall: stall },
      notes: ['Stall diagnostics (expand, via SetCursorPos): cursor at 512,3.'],
    });
    expect(stalled.morphStall).toBe(stall);
    const markdown = renderMarkdown(stalled);
    expect(markdown).toContain('- Stall diagnostics (expand, via SetCursorPos): cursor at 512,3.');
    expect(markdown).toContain('<summary>Shell log at the expand stall (last 2 lines)</summary>');
    expect(markdown).toContain(`  60000 ms  ${MEMORY_TARGET}`);
    expect(markdown.indexOf('</details>')).toBeLessThan(
      markdown.indexOf('<!-- muna-perf-report -->'),
    );
    const lastOnly = renderStallLog(stall, 1).join('\n');
    expect(lastOnly).toContain('(last 1 lines)');
    expect(lastOnly).toContain(MEMORY_TARGET);
    expect(lastOnly).not.toContain(READY);
    expect(renderStallLog({ ...stall, recentLog: [] })).toEqual([]);
  });

  it('keeps the cold expand apart and fails a frameless morph in the measured set (#71)', () => {
    const frameless = parseMorphLine(
      MORPH.replace(
        'expanded=false fps=153 frames=61 duration_ms=399 max_frame_ms=22',
        'expanded=true fps=0 frames=0 duration_ms=180 max_frame_ms=180',
      ),
    );
    expect(frameless).toMatchObject({ expanded: true, fps: 0, frames: 0, durationMs: 180 });
    const warm = [
      { expanded: true, fps: 70, frames: 9, durationMs: 128, maxFrameMs: 15, dropped: 0 },
      { expanded: false, fps: 74, frames: 10, durationMs: 135, maxFrameMs: 15, dropped: 0 },
    ];
    const coldExpand = { fps: 40, frames: 7, durationMs: 175, maxFrameMs: 80, atMs: 321000 };
    const booked = buildReport({
      mode: 'full',
      plan: planFor('full'),
      exe,
      host,
      results: { ...results, morphs: warm, coldExpand },
    });
    expect(booked.coldExpand).toEqual(coldExpand);
    expect(booked.measurements.morphFpsMin).toBe(70);
    expect(booked.evaluation.failed).not.toContain('morphFpsMin');
    expect(renderMarkdown(booked)).toContain(
      'cold first expand 40 fps, 7 frames over 175 ms (not gated until #81 brings it back in)',
    );

    const measured = buildReport({
      mode: 'full',
      plan: planFor('full'),
      exe,
      host,
      results: { ...results, morphs: [...warm, frameless] },
    });
    expect(measured.coldExpand).toBeNull();
    expect(measured.measurements.morphFpsMin).toBe(0);
    expect(measured.evaluation.failed).toContain('morphFpsMin');
    expect(renderMarkdown(measured)).not.toContain('cold first expand');
  });
});

describe('stall notes', () => {
  it('describes a stall without window titles and names the input path', () => {
    const line = describeStall({
      phase: 'expand',
      mover: 'input',
      error: 'no matching morph within 6000 ms',
      requested: { x: 512, y: 3 },
      lastMove: { ok: true, x: 512, y: 3 },
      cursor: { ok: true, x: 511, y: 3 },
      under: {
        hwnd: 9,
        className: 'Chrome_WidgetWin_1',
        pid: 4,
        processName: 'msedge',
        rect: { left: 0, top: 0, right: 1024, bottom: 768 },
        caption: false,
        popup: true,
        clickThrough: false,
        topmost: false,
      },
      foreground: { hwnd: 0, className: '', pid: 0 },
      windows: [
        {
          left: 312,
          top: 0,
          right: 712,
          bottom: 38,
          visible: true,
          clickThrough: true,
          dpi: 96,
        },
      ],
      memoryTarget: 'low',
      morphsSoFar: 2,
      recentLog: [
        { atMs: 10, line: '[INFO] shell ready label="notch" since_start_ms=771' },
        { atMs: 20, line: '[WARN] set_click_through failed hwnd=9 error=Access is denied' },
      ],
    });
    expect(line).toBe(
      'Stall diagnostics (expand, via SendInput): asked for 512,3, cursor at 511,3, last move ok; ' +
        'under the point: Chrome_WidgetWin_1 (msedge) 0,0–1024,768 [popup]; foreground: none; ' +
        'notch window 312,0–712,38 click-through; memory target low; 2 morph lines so far; ' +
        'shell warnings: [WARN] set_click_through failed hwnd=9 error=Access is denied.',
    );
  });

  it('reports probe failures instead of throwing', () => {
    const line = describeStall({
      phase: 'collapse',
      mover: 'cursor',
      error: 'timeout',
      requested: { x: 100, y: 600 },
      lastMove: null,
      cursor: { error: 'probe exited' },
      under: { error: 'probe exited' },
      foreground: { error: 'probe exited' },
      windows: { error: 'probe exited' },
      memoryTarget: 'normal',
      morphsSoFar: 1,
      recentLog: [],
    });
    expect(line).toContain('cursor unknown (probe exited)');
    expect(line).toContain('no move was answered');
    expect(line).toContain('under the point: probe error: probe exited');
    expect(line).toContain('windows unknown (probe exited)');
    expect(line.endsWith('; no shell warnings.')).toBe(true);
  });

  it('says when the memory target last changed', () => {
    const line = describeStall({
      phase: 'expand',
      mover: 'input',
      error: 'timeout',
      requested: { x: 512, y: 3 },
      lastMove: { ok: true, x: 512, y: 3 },
      cursor: { ok: true, x: 512, y: 3 },
      under: { hwnd: 0, className: '', pid: 0 },
      foreground: { hwnd: 0, className: '', pid: 0 },
      windows: [],
      memoryTarget: 'normal',
      memoryTargetChange: { target: 'normal', agoMs: 6250 },
      morphsSoFar: 0,
      recentLog: [],
    });
    expect(line).toContain('memory target normal (normal requested 6.3 s earlier)');
  });
});

describe('morph drive', () => {
  /**
   * A shell that expands while the cursor sits on the strip and collapses when it leaves; the
   * expands numbered in `lost` (0 = the cold one) never see the leave, as in #75.
   */
  const fakeSession = (expands, lost = []) => {
    const listeners = new Set();
    const app = {
      morphs: [],
      memoryTargets: [],
      memoryTarget: 'normal',
      elapsedMs: 0,
      recentLog: () => [],
      waitForMorph(predicate, timeoutMs) {
        return new Promise((resolve, reject) => {
          const listener = (record) => {
            if (!predicate(record)) return;
            listeners.delete(listener);
            resolve(record);
          };
          listeners.add(listener);
          setTimeout(
            () => reject(new Error(`no matching morph within ${timeoutMs} ms`)),
            timeoutMs,
          );
        });
      },
    };
    const emit = (morph) => {
      const record = { label: 'notch', dropped: 0, ...morph, atMs: app.morphs.length };
      app.morphs.push(record);
      for (const listener of [...listeners]) listener(record);
    };
    let open = false;
    let opened = -1;
    const move = async (_x, y) => {
      if (!open && y < 10) {
        open = true;
        opened += 1;
        emit({ expanded: true, ...expands.shift() });
      } else if (open && y > 500 && !lost.includes(opened)) {
        open = false;
        emit({ expanded: false, fps: 74, frames: 10, durationMs: 135, maxFrameMs: 15 });
      }
      return { ok: true };
    };
    const window = { left: 12, top: 0, right: 1012, bottom: 440, dpi: 96, visible: true };
    const probe = { windows: async () => [window], input: move, cursor: move };
    return { app, probe };
  };
  const host = { screenWidth: 1024, screenHeight: 768 };
  const warm = { fps: 70, frames: 9, durationMs: 128, maxFrameMs: 15 };
  const slow = { fps: 40, frames: 7, durationMs: 175, maxFrameMs: 80 };
  const frameless = { fps: 0, frames: 0, durationMs: 180, maxFrameMs: 180 };

  const drive = async (expands, count, lost = []) => {
    vi.useFakeTimers();
    try {
      const { app, probe } = fakeSession(expands, lost);
      const driven = driveMorphs(app, probe, host, count, () => {});
      await vi.runAllTimersAsync();
      return await driven;
    } finally {
      vi.useRealTimers();
    }
  };

  it('books the first expand as the cold expand and measures the cycles after it (#71)', async () => {
    const driven = await drive([slow, warm, warm], 2);
    expect(driven.coldExpand).toEqual({ ...slow, atMs: 0 });
    expect(driven.morphs.filter((m) => m.expanded)).toEqual([
      expect.objectContaining(warm),
      expect.objectContaining(warm),
    ]);
    // The cold cycle's collapse stays gated: 2 expands, 3 collapses.
    expect(driven.morphs.filter((m) => !m.expanded)).toHaveLength(3);
    expect(morphSummary(driven.morphs).minFps).toBe(70);
    expect(driven.stall).toBeNull();
    expect(driven.notes.join('\n')).toContain(
      'reported as `coldExpand` and not gated until #81 brings it back in, its collapse is measured, and 2 measured cycles followed it.',
    );
  });

  it('says only what followed the cold expand when its collapse never came (#75)', async () => {
    const driven = await drive([slow, warm, warm], 2, [0]);
    expect(driven.coldExpand).toEqual({ ...slow, atMs: 0 });
    expect(driven.morphs).toEqual([]);
    expect(driven.stall).toMatchObject({ phase: 'collapse' });
    const notes = driven.notes.join('\n');
    expect(notes).toContain(
      'not gated until #81 brings it back in; its collapse was not reported, so no measured cycle followed it.',
    );
    expect(notes).not.toContain('its collapse is measured');
    expect(notes).toContain('Cycle 1: the panel did not collapse');
  });

  it('counts the measured cycles that ran when a later collapse never came', async () => {
    const driven = await drive([slow, warm, warm, warm], 3, [2]);
    expect(driven.notes.join('\n')).toContain(
      'its collapse is measured, and 1 of the 3 measured cycles followed it.',
    );
    expect(driven.notes.join('\n')).toContain('Cycle 2: the panel did not collapse');
  });

  it('keeps a frameless expand after the first cycle in the measured set', async () => {
    const driven = await drive([warm, frameless, warm], 2);
    expect(driven.coldExpand).toEqual({ ...warm, atMs: 0 });
    expect(morphSummary(driven.morphs).minFps).toBe(0);
  });
});
