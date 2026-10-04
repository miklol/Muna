// Pure half of the performance harness: budgets, run plans, log-line parsing, statistics,
// budget evaluation and the JSON/markdown report (docs/09-testing-qa.md "Performance harness",
// docs/11-ci-cd.md "Performance gates"). No I/O here so `report.test.mjs` can cover it.

/** PRD budgets (docs/01-product-vision.md "Performance"). Keys are the measurement names. */
export const budgets = Object.freeze({
  startupMs: {
    max: 1500,
    unit: 'ms',
    description: 'Cold start to first strip paint',
  },
  idleCpuPercent: {
    max: 0.3,
    unit: '%',
    description:
      'Idle CPU at steady state, whole process tree, normalised to all logical processors',
  },
  privateWorkingSetMb: {
    max: 120,
    unit: 'MB',
    description: 'Private working set of the process tree, idle',
  },
  morphFpsMin: {
    min: 58,
    unit: 'fps',
    description: 'Slowest strip ↔ panel morph',
  },
});

/**
 * What each mode measures (docs/11-ci-cd.md "Performance gates": the PR smoke waits 5 s and
 * then samples the tree every `memorySampleSeconds` until `memoryAfterSeconds` — past the
 * shell's idle trim, 30 s after the cursor left the notch; the nightly run uses the full
 * windows from docs/09). CPU comes from the same samples: the gated idle CPU is the steady
 * state, the last `cpuSeconds` of the run, and the first `cpuSeconds` after the warm-up are
 * reported as the settling phase, so `memoryAfterSeconds - warmupSeconds` must be at least
 * `2 * cpuSeconds` for the two not to overlap (`idleCpuSummary`). Durations in seconds.
 */
export function planFor(mode) {
  if (mode === 'full') {
    return {
      mode,
      warmupSeconds: 30,
      cpuSeconds: 60,
      memoryAfterSeconds: 300,
      memorySampleSeconds: 10,
      morphs: 20,
    };
  }
  return {
    mode: 'smoke',
    warmupSeconds: 5,
    cpuSeconds: 30,
    memoryAfterSeconds: 90,
    memorySampleSeconds: 5,
    morphs: 0,
  };
}

const READY_LINE = /\[INFO\] shell ready label="(?<label>[^"]*)" since_start_ms=(?<since>\d+)/;
const MORPH_LINE =
  /\[INFO\] morph label="(?<label>[^"]*)" expanded=(?<expanded>true|false) fps=(?<fps>\d+) frames=(?<frames>\d+) duration_ms=(?<duration>\d+) max_frame_ms=(?<maxFrame>\d+) dropped=(?<dropped>\d+)/;
const MEMORY_TARGET_LINE =
  /\[INFO\] webview memory target target=(?<target>Normal|Low) windows=(?<windows>\d+)/;

/** `shell ready` log line → `{ label, sinceStartMs }`, or `null` for any other line. */
export function parseReadyLine(line) {
  const match = READY_LINE.exec(line);
  if (!match?.groups) return null;
  return { label: match.groups.label, sinceStartMs: Number(match.groups.since) };
}

/**
 * `webview memory target` log line (shell::manager, the idle trim of
 * docs/modules/notch-shell.md) → `{ target: 'normal' | 'low', windows }`, or `null`.
 */
export function parseMemoryTargetLine(line) {
  const match = MEMORY_TARGET_LINE.exec(line);
  if (!match?.groups) return null;
  return { target: match.groups.target.toLowerCase(), windows: Number(match.groups.windows) };
}

/** `morph` log line (ipc::report_morph) → one morph record, or `null` for any other line. */
export function parseMorphLine(line) {
  const match = MORPH_LINE.exec(line);
  if (!match?.groups) return null;
  const g = match.groups;
  return {
    label: g.label,
    expanded: g.expanded === 'true',
    fps: Number(g.fps),
    frames: Number(g.frames),
    durationMs: Number(g.duration),
    maxFrameMs: Number(g.maxFrame),
    dropped: Number(g.dropped),
  };
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile, `p` in 0..100. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

/**
 * Average CPU of a process tree between two snapshots of per-process CPU time. Processes that
 * exist in only one snapshot contribute what is known about them: a process that appeared
 * mid-window counts from zero, one that exited mid-window loses the time after its last sample.
 * Returns the Task Manager style percentage (all logical processors = 100 %) and the raw one
 * (one core = 100 %).
 */
export function cpuPercent(before, after, wallMs, logicalProcessors) {
  if (wallMs <= 0 || logicalProcessors <= 0) return { normalised: null, raw: null };
  const start = new Map(before.map((p) => [p.pid, p.cpuMs]));
  let deltaMs = 0;
  for (const p of after) {
    const from = start.get(p.pid) ?? 0;
    deltaMs += Math.max(0, p.cpuMs - from);
  }
  const raw = (deltaMs / wallMs) * 100;
  return { normalised: raw / logicalProcessors, raw };
}

/**
 * CPU of the tree between consecutive idle samples. A sample is
 * `{ atSeconds, wallMs, processes: [{ pid, cpuMs }] }` — `atSeconds` the nominal time since
 * launch, `wallMs` a monotonic clock reading taken with it — and a window spans two
 * consecutive samples, so the per-process CPU times the memory samples already carry give
 * the CPU curve for free.
 */
export function cpuWindows(samples, logicalProcessors) {
  const windows = [];
  for (let i = 1; i < samples.length; i += 1) {
    const from = samples[i - 1];
    const to = samples[i];
    const wallMs = to.wallMs - from.wallMs;
    windows.push({
      fromSeconds: from.atSeconds,
      toSeconds: to.atSeconds,
      wallMs: Math.round(wallMs),
      ...cpuPercent(from.processes, to.processes, wallMs, logicalProcessors),
    });
  }
  return windows;
}

/**
 * Idle CPU from the per-window curve. The gated value is the **median** of the windows in the
 * last `plan.cpuSeconds` of the idle phase — the steady state, after WebView2 has finished the
 * work its memory trim sets off — so one busy window (a GC, a trim, a runner hiccup) does not
 * decide the gate while a timer that never stops, present in every window, still does; the
 * mean and the busiest window are reported next to it for the periodic work a median hides.
 * The first `plan.cpuSeconds` after the warm-up are summarised as the `settling` phase, which
 * is what the gate used to measure. `null` without windows; a phase is `null` when no window
 * falls inside it.
 */
export function idleCpuSummary(windows, plan) {
  const measured = windows.filter((w) => w.normalised !== null);
  if (measured.length === 0) return null;
  const phase = (subset) => {
    if (subset.length === 0) return null;
    const normalised = subset.map((w) => w.normalised);
    const raw = subset.map((w) => w.raw);
    const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      fromSeconds: subset[0].fromSeconds,
      toSeconds: subset[subset.length - 1].toSeconds,
      windows: subset.length,
      median: { normalised: median(normalised), raw: median(raw) },
      mean: { normalised: mean(normalised), raw: mean(raw) },
      max: { normalised: Math.max(...normalised), raw: Math.max(...raw) },
    };
  };
  const start = measured[0].fromSeconds;
  const end = measured[measured.length - 1].toSeconds;
  const steadyState = phase(measured.filter((w) => w.fromSeconds >= end - plan.cpuSeconds));
  const settling = phase(measured.filter((w) => w.toSeconds <= start + plan.cpuSeconds));
  return {
    windowSeconds: plan.memorySampleSeconds,
    steadyState,
    settling,
    overlap:
      steadyState !== null && settling !== null && settling.toSeconds > steadyState.fromSeconds,
    windows: measured,
  };
}

/**
 * Summary of one memory sample list (private working set in MB per sample). Samples carry
 * `memoryTarget` (`'normal'` or `'low'`, the shell's idle trim); when the trim was observed the
 * gated `idle` value is the median of the samples taken at the low target, otherwise the final
 * sample. `normal` keeps the pre-trim numbers so a regression there stays visible.
 */
export function memorySummary(samples) {
  if (samples.length === 0) return null;
  const tenth = (value) => Math.round(value * 10) / 10;
  const stats = (values) => ({
    final: tenth(values[values.length - 1]),
    min: tenth(Math.min(...values)),
    median: tenth(median(values)),
    max: tenth(Math.max(...values)),
    samples: values.length,
  });
  const values = samples.map((s) => s.privateWorkingSetMb);
  const low = samples.filter((s) => s.memoryTarget === 'low').map((s) => s.privateWorkingSetMb);
  const normal = samples.filter((s) => s.memoryTarget !== 'low').map((s) => s.privateWorkingSetMb);
  return {
    ...stats(values),
    idle: low.length > 0 ? tenth(median(low)) : tenth(values[values.length - 1]),
    trimmed: low.length > 0,
    normal: normal.length > 0 ? stats(normal) : null,
    low: low.length > 0 ? stats(low) : null,
  };
}

/**
 * How far under the window's top edge the cursor travels to reveal the strip, in logical px:
 * the middle of the 6 px sliver (`PEEK_HEIGHT_PX`) the strip keeps on screen while it peeks.
 */
export const STRIP_PROBE_DEPTH_PX = 3;

/**
 * Where the cursor lands to reveal the strip of a placed notch window (physical px).
 *
 * The strip rests at the window's top centre (200 × 32 logical px for the default Notch
 * shape), but a foreground window whose caption runs under it — a maximised terminal or
 * browser, which is what a CI runner and most desks have — makes the shell *peek*: the strip
 * slides up until only its bottom 6 px stay on screen and the band below clicks through to
 * the app behind (docs/modules/notch-shell.md, "Peek hit-testing"). Hover intent still applies
 * on that sliver, so a path 3 logical px under the top edge reveals and opens the strip
 * whether it rests or peeks; the strip's centre line (14 px) misses the window entirely while
 * it peeks, which reproduces the stall at cycle 1 that every nightly from 2026-09-30 to
 * 2026-10-03 reported.
 */
export function stripProbePoint(window) {
  const scale = window.dpi / 96;
  return {
    x: (window.left + window.right) / 2,
    y: window.top + STRIP_PROBE_DEPTH_PX * scale,
  };
}

/** Per-direction and overall morph statistics from parsed `morph` lines. */
export function morphSummary(morphs) {
  if (morphs.length === 0) return null;
  const fps = morphs.map((m) => m.fps);
  const direction = (expanded) => {
    const subset = morphs.filter((m) => m.expanded === expanded);
    return subset.length === 0
      ? null
      : {
          count: subset.length,
          medianDurationMs: median(subset.map((m) => m.durationMs)),
          minFps: Math.min(...subset.map((m) => m.fps)),
        };
  };
  return {
    count: morphs.length,
    minFps: Math.min(...fps),
    medianFps: median(fps),
    maxFrameMs: Math.max(...morphs.map((m) => m.maxFrameMs)),
    droppedFrames: morphs.reduce((sum, m) => sum + m.dropped, 0),
    expand: direction(true),
    collapse: direction(false),
  };
}

const round = (value, digits) => {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Compares measurements with the budgets. `measurements` maps budget keys to numbers or
 * `null` (not measured in this mode). A `null` never fails; a breach or a missing value that
 * the plan promised does.
 *
 * `profile` is the Cargo profile of the measured binary. The start-up budget describes the
 * shipped build, so on any profile but `release` the start-up is reported next to its budget
 * without gating (`informational`, or `informational-over` when it is above the budget) —
 * the rule `bundle:check` applies to the exe size (docs/11-ci-cd.md "Performance gates").
 * Idle CPU and memory of a debug build are upper bounds for the release build and gate on
 * every profile.
 */
export function evaluate(measurements, plan, activeBudgets = budgets, profile = 'release') {
  const checks = [];
  for (const [metric, budget] of Object.entries(activeBudgets)) {
    const value = measurements[metric] ?? null;
    const expected = metric !== 'morphFpsMin' || plan.morphs > 0;
    let status;
    if (value === null) {
      status = expected ? 'missing' : 'skipped';
    } else if (metric === 'startupMs' && profile !== 'release') {
      status = value <= budget.max ? 'informational' : 'informational-over';
    } else if ('max' in budget) {
      status = value <= budget.max ? 'pass' : 'fail';
    } else {
      status = value >= budget.min ? 'pass' : 'fail';
    }
    checks.push({ metric, value, budget, status });
  }
  const failed = checks.filter((c) => c.status === 'fail' || c.status === 'missing');
  return { checks, pass: failed.length === 0, failed: failed.map((c) => c.metric) };
}

const formatValue = (value, unit) => {
  if (value === null || value === undefined) return '—';
  const digits = unit === '%' ? 3 : unit === 'MB' ? 1 : 0;
  return `${round(value, digits)} ${unit}`;
};

const formatBudget = (budget) =>
  'max' in budget ? `≤ ${budget.max} ${budget.unit}` : `≥ ${budget.min} ${budget.unit}`;

const formatDelta = (value, baselineValue, unit) => {
  if (value === null || baselineValue === null || baselineValue === undefined) return '—';
  const delta = value - baselineValue;
  const digits = unit === '%' ? 3 : unit === 'MB' ? 1 : 0;
  const sign = delta > 0 ? '+' : '';
  return `${sign}${round(delta, digits)} ${unit}`;
};

const statusWord = {
  pass: 'pass',
  fail: '**fail**',
  missing: '**not measured**',
  skipped: 'nightly',
  informational: 'reported (debug build)',
  'informational-over': '**over budget**, reported (debug build)',
};

/** The idle CPU detail: the gated steady state with its spread, then the settling phase. */
function describeIdleCpu(measurements, idleCpu) {
  const steady = idleCpu?.steadyState;
  if (!steady) return `idle CPU ${round(measurements.idleCpuRawPercent, 2)} % of one core`;
  const span = (phase) => `${phase.fromSeconds}–${phase.toSeconds} s`;
  let text = `idle CPU ${round(steady.median.raw, 2)} % of one core (median of ${steady.windows} × ${idleCpu.windowSeconds} s windows over ${span(steady)}; mean ${round(steady.mean.raw, 2)} %, busiest window ${round(steady.max.raw, 2)} %)`;
  if (idleCpu.settling) {
    text += `, settling ${round(idleCpu.settling.mean.raw, 2)} % over ${span(idleCpu.settling)} (not gated)`;
  }
  return text;
}

/**
 * PR comment / nightly summary. Ends with the `<!-- muna-perf-report -->` marker the `app`
 * job edits in place. `baseline` is the JSON of an earlier run (same shape) or `null`.
 */
export function renderMarkdown(report, baseline = null) {
  const { mode, evaluation, measurements, host, notes = [] } = report;
  const headline = report.status === 'measured' ? (evaluation.pass ? 'pass' : 'fail') : 'not run';
  const lines = [`### Perf ${mode} — ${headline}`, ''];
  if (report.status !== 'measured') {
    lines.push(report.error ?? 'The harness did not produce measurements.', '');
  } else {
    lines.push(
      `| Metric | Value | Budget | Δ vs baseline | Result |`,
      `| --- | ---: | --- | ---: | --- |`,
    );
    for (const check of evaluation.checks) {
      const baselineValue = baseline?.measurements?.[check.metric] ?? null;
      lines.push(
        `| ${check.budget.description} | ${formatValue(check.value, check.budget.unit)} | ${formatBudget(check.budget)} | ${formatDelta(check.value, baselineValue, check.budget.unit)} | ${statusWord[check.status]} |`,
      );
    }
    lines.push('');
    const details = [];
    if (measurements.sinceMainMs !== null && measurements.sinceMainMs !== undefined) {
      details.push(`first paint ${measurements.sinceMainMs} ms after \`main\``);
    }
    if (measurements.webviewBrowserAtMs !== null && measurements.webviewBrowserAtMs !== undefined) {
      details.push(
        `WebView2 browser process created ${measurements.webviewBrowserAtMs} ms after the app`,
      );
    }
    if (measurements.firstRendererAtMs !== null && measurements.firstRendererAtMs !== undefined) {
      details.push(`first renderer ${measurements.firstRendererAtMs} ms after the app`);
    }
    if (measurements.firstLaunchMs !== null && measurements.firstLaunchMs !== undefined) {
      details.push(`first launch of this binary ${measurements.firstLaunchMs} ms (not gated)`);
    }
    if (measurements.idleCpuRawPercent !== null && measurements.idleCpuRawPercent !== undefined) {
      details.push(describeIdleCpu(measurements, report.idleCpu));
    }
    if (measurements.workingSetMb !== null && measurements.workingSetMb !== undefined) {
      details.push(`working set ${round(measurements.workingSetMb, 1)} MB`);
    }
    if (measurements.memoryTrimObserved === true) {
      details.push(
        `${round(measurements.privateWorkingSetBeforeTrimMb, 1)} MB private before the idle trim`,
      );
    } else if (measurements.memoryTrimObserved === false) {
      details.push('idle memory trim not observed');
    }
    if (measurements.processes !== null && measurements.processes !== undefined) {
      details.push(`${measurements.processes} processes`);
    }
    if (report.morphs?.count) {
      details.push(
        `${report.morphs.count} morphs, median ${round(report.morphs.medianFps, 0)} fps, longest frame ${report.morphs.maxFrameMs} ms, ${report.morphs.droppedFrames} dropped`,
      );
    }
    if (details.length > 0) lines.push(`Details: ${details.join(' · ')}.`, '');
    if (baseline && report.idleCpu && !baseline.idleCpu) {
      lines.push(
        'The baseline predates the steady-state idle CPU method, so its idle CPU delta compares the settling phase of that run with the steady state of this one.',
        '',
      );
    }
  }
  if (host) {
    lines.push(
      `Host: ${host.os}, ${host.logicalProcessors} logical processors, ${host.memoryGb} GB · build: \`${report.exe?.profile ?? 'unknown'}\`${baseline ? ` · baseline: ${baseline.generatedAt ?? 'unknown'}` : ' · no baseline'}.`,
      '',
    );
  }
  for (const note of notes) lines.push(`- ${note}`);
  if (notes.length > 0) lines.push('');
  lines.push('<!-- muna-perf-report -->', '');
  return lines.join('\n');
}

/**
 * Where the cold start went, from the process tree captured right after `shell ready`:
 * creation times of the WebView2 browser process and of the first renderer, in ms after the
 * app process itself was created. `null` when the tree does not show the process (the app
 * ran without WebView2, or the probe could not read creation times).
 */
export function startupBreakdown(tree, appPid) {
  const app = tree.find((p) => p.pid === appPid);
  if (!app || typeof app.startedAtMs !== 'number') {
    return { webviewBrowserAtMs: null, firstRendererAtMs: null };
  }
  const firstOf = (kind) => {
    const times = tree
      .filter((p) => p.kind === kind && typeof p.startedAtMs === 'number')
      .map((p) => p.startedAtMs - app.startedAtMs);
    return times.length > 0 ? Math.max(0, Math.min(...times)) : null;
  };
  return { webviewBrowserAtMs: firstOf('browser'), firstRendererAtMs: firstOf('renderer') };
}

/**
 * Assembles the JSON report from raw results; `null` fields mean "not measured". `results.idleCpu`
 * is an `idleCpuSummary` (the steady-state median gates, the mean and the settling phase are
 * reported); `results.cpu` is the pre-2026-10 shape `{ normalised, raw }` of a single window,
 * still accepted so older runs can be re-rendered.
 */
export function buildReport({ mode, plan, exe, host, results, notes = [], generatedAt }) {
  const memory = memorySummary(results.memorySamples ?? []);
  const morphs = morphSummary(results.morphs ?? []);
  const idleCpu = results.idleCpu ?? null;
  const steady = idleCpu?.steadyState ?? null;
  const measurements = {
    startupMs: results.startupMs ?? null,
    firstLaunchMs: results.firstLaunchMs ?? null,
    sinceMainMs: results.sinceMainMs ?? null,
    webviewBrowserAtMs: results.webviewBrowserAtMs ?? null,
    firstRendererAtMs: results.firstRendererAtMs ?? null,
    idleCpuPercent: round(steady ? steady.median.normalised : (results.cpu?.normalised ?? null), 4),
    idleCpuRawPercent: round(steady ? steady.median.raw : (results.cpu?.raw ?? null), 3),
    idleCpuMeanPercent: round(steady?.mean.normalised ?? null, 4),
    idleCpuMaxPercent: round(steady?.max.normalised ?? null, 4),
    settlingCpuPercent: round(idleCpu?.settling?.mean.normalised ?? null, 4),
    privateWorkingSetMb: memory ? round(memory.idle, 1) : null,
    privateWorkingSetBeforeTrimMb: memory?.normal ? round(memory.normal.median, 1) : null,
    memoryTrimObserved: memory ? memory.trimmed : null,
    workingSetMb: results.workingSetMb ?? null,
    processes: results.processes ?? null,
    morphFpsMin: morphs ? morphs.minFps : null,
  };
  const evaluation = evaluate(measurements, plan, budgets, exe?.profile ?? 'release');
  return {
    mode,
    status: 'measured',
    generatedAt: generatedAt ?? new Date().toISOString(),
    exe,
    host,
    plan,
    budgets,
    measurements,
    idleCpu,
    memory,
    morphs,
    processTree: results.processTree ?? [],
    rawMorphs: results.morphs ?? [],
    evaluation,
    notes,
  };
}

/** Report for a run that could not measure anything (exit code stays non-zero). */
export function failedReport({ mode, plan, exe, host, error, generatedAt }) {
  return {
    mode,
    status: 'failed',
    generatedAt: generatedAt ?? new Date().toISOString(),
    exe,
    host,
    plan,
    budgets,
    error,
    measurements: {},
    evaluation: { checks: [], pass: false, failed: [] },
    notes: [],
  };
}
