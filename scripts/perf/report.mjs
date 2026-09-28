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
    description: 'Idle CPU, whole process tree, normalised to all logical processors',
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
 * What each mode measures (docs/11-ci-cd.md "Performance gates": the PR smoke waits 5 s,
 * samples CPU for 30 s and keeps sampling memory until the shell's idle trim — 30 s after the
 * cursor left the notch — has settled; the nightly run uses the full windows from docs/09).
 * Durations in seconds.
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
 */
export function evaluate(measurements, plan, activeBudgets = budgets) {
  const checks = [];
  for (const [metric, budget] of Object.entries(activeBudgets)) {
    const value = measurements[metric] ?? null;
    const expected = metric !== 'morphFpsMin' || plan.morphs > 0;
    let status;
    if (value === null) {
      status = expected ? 'missing' : 'skipped';
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
};

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
    if (measurements.firstLaunchMs !== null && measurements.firstLaunchMs !== undefined) {
      details.push(`first launch of this binary ${measurements.firstLaunchMs} ms (not gated)`);
    }
    if (measurements.idleCpuRawPercent !== null && measurements.idleCpuRawPercent !== undefined) {
      details.push(`idle CPU ${round(measurements.idleCpuRawPercent, 2)} % of one core`);
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

/** Assembles the JSON report from raw results; `null` fields mean "not measured". */
export function buildReport({ mode, plan, exe, host, results, notes = [], generatedAt }) {
  const memory = memorySummary(results.memorySamples ?? []);
  const morphs = morphSummary(results.morphs ?? []);
  const measurements = {
    startupMs: results.startupMs ?? null,
    firstLaunchMs: results.firstLaunchMs ?? null,
    sinceMainMs: results.sinceMainMs ?? null,
    idleCpuPercent: round(results.cpu?.normalised ?? null, 4),
    idleCpuRawPercent: round(results.cpu?.raw ?? null, 3),
    privateWorkingSetMb: memory ? round(memory.idle, 1) : null,
    privateWorkingSetBeforeTrimMb: memory?.normal ? round(memory.normal.median, 1) : null,
    memoryTrimObserved: memory ? memory.trimmed : null,
    workingSetMb: results.workingSetMb ?? null,
    processes: results.processes ?? null,
    morphFpsMin: morphs ? morphs.minFps : null,
  };
  const evaluation = evaluate(measurements, plan);
  return {
    mode,
    status: 'measured',
    generatedAt: generatedAt ?? new Date().toISOString(),
    exe,
    host,
    plan,
    budgets,
    measurements,
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
