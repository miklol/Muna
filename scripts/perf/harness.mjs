// Runs the app and takes the measurements. Plain Node on top of `probe.ps1` for the Win32
// side; the pure maths and the report live in `report.mjs`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { repoRoot } from '../lib.mjs';
import {
  cpuPercent,
  cpuWindows,
  idleCpuSummary,
  parseMemoryTargetLine,
  parseMorphLine,
  parseReadyLine,
  stripProbePoint,
} from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How many of the app's log lines the harness keeps for a stall snapshot. */
const RECENT_LOG_LINES = 40;
/** How long one morph (expand or collapse) may take to be reported before the cycle stalls. */
const MORPH_TIMEOUT_MS = 6000;
/** Cursor drift step while aiming at the strip: 1 px every 60 ms, well under hover-intent speed. */
const DRIFT_INTERVAL_MS = 60;
/** The two ways the probe can move the cursor, by the Win32 call behind each. */
const MOVER_NAMES = { input: 'SendInput', cursor: 'SetCursorPos' };

/** The binary `pnpm --filter @muna/desktop tauri build --debug --no-bundle` produces. */
export function defaultExe() {
  const target = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'target');
  for (const profile of ['debug', 'release']) {
    const exe = path.join(target, profile, 'muna.exe');
    if (existsSync(exe)) return { path: exe, profile };
  }
  return { path: path.join(target, 'debug', 'muna.exe'), profile: 'debug' };
}

function powershell() {
  for (const candidate of ['pwsh', 'powershell']) {
    const probe = spawnSync(
      candidate,
      ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
      {
        encoding: 'utf8',
      },
    );
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error('PowerShell is required for the perf probe (pwsh or powershell).');
}

/** Long-lived `probe.ps1` process; one JSON answer per command. */
export class Probe {
  #child;
  #lines;
  #queue = [];
  #closed = false;

  constructor() {
    const script = path.join(repoRoot, 'scripts', 'perf', 'probe.ps1');
    this.#child = spawn(
      powershell(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on('line', (line) => {
      const waiter = this.#queue.shift();
      if (waiter) waiter(line);
    });
    this.#child.once('exit', () => {
      this.#closed = true;
      for (const waiter of this.#queue.splice(0)) waiter('{"error":"probe exited"}');
    });
    this.ready = this.#send(null);
  }

  #send(command) {
    if (this.#closed) return Promise.reject(new Error('probe exited'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`probe timed out on '${command ?? 'ready'}'`)),
        60_000,
      );
      this.#queue.push((line) => {
        clearTimeout(timer);
        try {
          const value = JSON.parse(line);
          if (value && typeof value === 'object' && !Array.isArray(value) && 'error' in value) {
            reject(new Error(`probe: ${value.error}`));
          } else {
            resolve(value);
          }
        } catch (error) {
          reject(new Error(`probe returned invalid JSON: ${line} (${error.message})`));
        }
      });
      if (command !== null) this.#child.stdin.write(`${command}\n`);
    });
  }

  host() {
    return this.#send('host');
  }

  tree(pid) {
    return this.#send(`tree ${pid}`);
  }

  sample(pids) {
    return this.#send(`sample ${pids.join(',')}`);
  }

  windows() {
    return this.#send('windows');
  }

  cursor(x, y) {
    return this.#send(`cursor ${Math.round(x)} ${Math.round(y)}`);
  }

  /** Current cursor position in physical pixels (`{ x, y }`). */
  cursorPosition() {
    return this.#send('cursor');
  }

  /** Absolute mouse move through `SendInput` (enters the input stack, unlike `cursor`). */
  input(x, y) {
    return this.#send(`input ${Math.round(x)} ${Math.round(y)}`);
  }

  /** The window `WindowFromPoint` names at a physical point (click-through windows are skipped). */
  point(x, y) {
    return this.#send(`point ${Math.round(x)} ${Math.round(y)}`);
  }

  foreground() {
    return this.#send('foreground');
  }

  close() {
    if (!this.#closed) {
      this.#child.stdin.write('quit\n');
      this.#child.stdin.end();
    }
  }
}

/**
 * A running Muna instance with a private profile directory (`LOCALAPPDATA` is redirected so
 * the run never touches the user's settings) and a stdout tail that timestamps the `shell
 * ready` and `morph` log lines.
 */
export class App {
  #child;
  #profile;
  #startedAt;
  #exitCode = null;
  #onMorph = new Set();
  #onReady = new Set();
  #recent = [];
  ready = [];
  morphs = [];
  /** `webview memory target` transitions with `atMs`; the last one is the current target. */
  memoryTargets = [];

  constructor(exe, { profile, log } = {}) {
    this.#profile = profile ?? mkdtempSync(path.join(tmpdir(), 'muna-perf-'));
    const env = {
      ...process.env,
      LOCALAPPDATA: this.#profile,
      WEBVIEW2_DEFAULT_BACKGROUND_COLOR: '00000000',
    };
    // `--autostart` keeps the settings window closed on this first run of a fresh profile.
    this.#startedAt = performance.now();
    this.#child = spawn(exe, ['--autostart'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.#child.once('exit', (code) => {
      this.#exitCode = code ?? -1;
    });
    const tail = (stream) => {
      createInterface({ input: stream }).on('line', (line) => {
        const at = performance.now() - this.#startedAt;
        log?.(line);
        this.#recent.push({ atMs: Math.round(at), line });
        if (this.#recent.length > RECENT_LOG_LINES) this.#recent.shift();
        const ready = parseReadyLine(line);
        if (ready) {
          const record = { ...ready, atMs: Math.round(at) };
          this.ready.push(record);
          for (const listener of this.#onReady) listener(record);
        }
        const morph = parseMorphLine(line);
        if (morph) {
          const record = { ...morph, atMs: Math.round(at) };
          this.morphs.push(record);
          for (const listener of this.#onMorph) listener(record);
        }
        const target = parseMemoryTargetLine(line);
        if (target) this.memoryTargets.push({ ...target, atMs: Math.round(at) });
      });
    };
    tail(this.#child.stdout);
    tail(this.#child.stderr);
  }

  get pid() {
    return this.#child.pid;
  }

  /** The shell's current webview memory target, `'normal'` until it logs otherwise. */
  get memoryTarget() {
    return this.memoryTargets.at(-1)?.target ?? 'normal';
  }

  get profile() {
    return this.#profile;
  }

  /** The last `max` log lines the app wrote (stdout and stderr), oldest first, with `atMs`. */
  recentLog(max = RECENT_LOG_LINES) {
    return this.#recent.slice(-max);
  }

  get exited() {
    return this.#exitCode !== null;
  }

  get exitCode() {
    return this.#exitCode;
  }

  /** Resolves with the first `shell ready` record for `label`; rejects on exit or timeout. */
  waitForReady(label, timeoutMs) {
    const existing = this.ready.find((r) => r.label === label);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#onReady.delete(listener);
        reject(new Error(`no "shell ready" for ${label} within ${timeoutMs} ms`));
      }, timeoutMs);
      const listener = (record) => {
        if (record.label !== label) return;
        clearTimeout(timer);
        this.#onReady.delete(listener);
        resolve(record);
      };
      this.#onReady.add(listener);
      const exitPoll = setInterval(() => {
        if (this.exited) {
          clearInterval(exitPoll);
          clearTimeout(timer);
          this.#onReady.delete(listener);
          reject(
            new Error(
              `muna.exe exited with code ${this.exitCode} before the shell was ready (another Muna instance running?)`,
            ),
          );
        }
        if (!this.#onReady.has(listener)) clearInterval(exitPoll);
      }, 100);
    });
  }

  /** Resolves with the next morph record matching `predicate`, or rejects after `timeoutMs`. */
  waitForMorph(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#onMorph.delete(listener);
        reject(new Error(`no matching morph within ${timeoutMs} ms`));
      }, timeoutMs);
      const listener = (record) => {
        if (!predicate(record)) return;
        clearTimeout(timer);
        this.#onMorph.delete(listener);
        resolve(record);
      };
      this.#onMorph.add(listener);
    });
  }

  /** Stops the process; the profile directory goes too unless `keepProfile` (for a relaunch). */
  async stop({ keepProfile = false } = {}) {
    if (!this.exited) {
      this.#child.kill();
      for (let i = 0; i < 50 && !this.exited; i += 1) await sleep(100);
    }
    // WebView2 children notice the host is gone within a moment; then the profile can go.
    await sleep(500);
    if (keepProfile) return;
    try {
      rmSync(this.#profile, { recursive: true, force: true });
    } catch {
      // A log file may still be held for a moment; the temp directory is harmless.
    }
  }
}

/** Sums one probe sample into the tree totals. */
function totals(sample) {
  return {
    processes: sample.length,
    workingSetMb: sample.reduce((sum, p) => sum + (p.workingSetMb ?? 0), 0),
    privateWorkingSetMb: sample.reduce((sum, p) => sum + (p.privateWorkingSetMb ?? 0), 0),
  };
}

/**
 * Idle phase: parks the cursor away from the notch and samples the tree every
 * `memorySampleSeconds` until `memoryAfterSeconds` (counted from launch; `elapsedSeconds` is
 * how far the run already is). Every sample is a memory sample and, with its per-process CPU
 * times, the end of one CPU window; the first sample is the CPU baseline only. The gated idle
 * CPU is the median window of the last `cpuSeconds` (the steady state, after WebView2's
 * memory trim has settled) and the first `cpuSeconds` are reported as the settling phase —
 * see `idleCpuSummary` in `report.mjs` and docs/09 "Performance harness".
 */
export async function measureIdle(app, probe, host, plan, elapsedSeconds, log) {
  await probe.cursor(host.screenWidth * 0.1, host.screenHeight - 120);
  const treeNow = async () => (await probe.tree(app.pid)).map((p) => p.pid);
  const memorySamples = [];
  const cpuSamples = [];
  const percent = (value) => (value === null ? '—' : value.toFixed(2));
  const take = async (atSeconds) => {
    const sample = await probe.sample(await treeNow());
    const wallMs = performance.now();
    const previous = cpuSamples.at(-1) ?? null;
    cpuSamples.push({
      atSeconds,
      wallMs,
      processes: sample.map((p) => ({ pid: p.pid, cpuMs: p.cpuMs })),
    });
    if (previous === null) return sample;
    const sum = totals(sample);
    const memoryTarget = app.memoryTarget;
    memorySamples.push({ atSeconds, memoryTarget, ...sum });
    const cpu = cpuPercent(
      previous.processes,
      sample,
      wallMs - previous.wallMs,
      host.logicalProcessors,
    );
    log(
      `at ${String(atSeconds).padStart(3)} s: CPU ${percent(cpu.raw)} % of one core (${percent(cpu.normalised)} % normalised) since ${previous.atSeconds} s · private ${sum.privateWorkingSetMb.toFixed(1)} MB, working set ${sum.workingSetMb.toFixed(1)} MB over ${sum.processes} processes, ${memoryTarget} target`,
    );
    return sample;
  };

  let elapsed = elapsedSeconds;
  let lastSample = await take(elapsed);
  log(
    `sampling CPU and memory every ${plan.memorySampleSeconds} s until ${plan.memoryAfterSeconds} s over ${lastSample.length} processes (idle CPU gates on the last ${plan.cpuSeconds} s)…`,
  );
  while (elapsed < plan.memoryAfterSeconds) {
    const step = Math.min(plan.memorySampleSeconds, plan.memoryAfterSeconds - elapsed);
    await sleep(step * 1000);
    elapsed += step;
    lastSample = await take(elapsed);
  }

  const idleCpu = idleCpuSummary(cpuWindows(cpuSamples, host.logicalProcessors), plan);
  const steady = idleCpu?.steadyState ?? null;
  const settling = idleCpu?.settling ?? null;
  if (steady) {
    log(
      `idle CPU, steady state ${steady.fromSeconds}–${steady.toSeconds} s: median ${steady.median.normalised.toFixed(3)} % of ${host.logicalProcessors} logical processors (${steady.median.raw.toFixed(2)} % of one core), mean ${steady.mean.raw.toFixed(2)} %, busiest window ${steady.max.raw.toFixed(2)} % of one core`,
    );
  }
  if (settling) {
    log(
      `idle CPU, settling ${settling.fromSeconds}–${settling.toSeconds} s: mean ${settling.mean.normalised.toFixed(3)} % normalised (${settling.mean.raw.toFixed(2)} % of one core), not gated`,
    );
  }

  // Per-process CPU time over each phase: `null` when the process appeared after the phase
  // ended, counted from zero when it appeared during it (like `cpuPercent`).
  const cpuAt = (atSeconds) => {
    const sample = cpuSamples.find((s) => s.atSeconds === atSeconds);
    return new Map((sample?.processes ?? []).map((p) => [p.pid, p.cpuMs]));
  };
  const spent = (from, to, pid) =>
    to.has(pid) ? Math.round((to.get(pid) - (from.get(pid) ?? 0)) * 10) / 10 : null;
  const steadyFrom = steady ? cpuAt(steady.fromSeconds) : new Map();
  const steadyTo = steady ? cpuAt(steady.toSeconds) : new Map();
  const settlingFrom = settling ? cpuAt(settling.fromSeconds) : new Map();
  const settlingTo = settling ? cpuAt(settling.toSeconds) : new Map();
  const last = totals(lastSample);
  return {
    idleCpu,
    memorySamples,
    workingSetMb: Math.round(last.workingSetMb * 10) / 10,
    processes: last.processes,
    processTree: lastSample.map((p) => ({
      pid: p.pid,
      name: p.name,
      privateWorkingSetMb: p.privateWorkingSetMb,
      workingSetMb: p.workingSetMb,
      idleCpuMs: spent(steadyFrom, steadyTo, p.pid),
      settlingCpuMs: spent(settlingFrom, settlingTo, p.pid),
    })),
    elapsedSeconds: elapsed,
  };
}

/**
 * Drives `count` expand/collapse cycles with the real cursor: it lands on the strip's top
 * sliver (`stripProbePoint`, inside the strip whether it rests or peeks) and drifts a pixel at
 * a time (well under the hover-intent velocity limit) until the shell reports the expand
 * morph, then parks far away until the collapse morph is reported. Returns the morph records;
 * a cycle that does not morph within its timeout ends the loop with a note.
 *
 * The cursor moves through `SendInput`, which travels the input stack like a real mouse. On
 * the hosted runner (Windows Server 2025, session 2) `SetCursorPos` moves the cursor and the
 * shell lifts click-through, yet WebView2 receives no mouse-move messages and the strip never
 * expands — nightly run 37197808643 recorded exactly that. When the first cycle does not
 * expand, the drive records what the desktop looked like — where the cursor really is, which
 * window `WindowFromPoint` names there, the foreground window, the notch window's
 * click-through bit and the shell's last log lines — and tries the cycle once more through
 * the other mover (`SetCursorPos`). The snapshot comes back as `stall` (kept in the JSON
 * report) and the notes say which path worked, so a stall on a CI runner can be read instead
 * of guessed.
 */
export async function driveMorphs(app, probe, host, count, log) {
  const notes = [];
  const windows = (await probe.windows()).filter((w) => w.visible);
  const primary = windows.find((w) => w.top >= 0 && w.top < host.screenHeight / 2);
  if (!primary) {
    notes.push(
      'No placed notch window was found (desktop locked or notch parked); morphs were not driven.',
    );
    return { morphs: [], notes, stall: null };
  }
  const point = stripProbePoint(primary);
  log(
    `notch window ${describeRect(primary)} at ${primary.dpi} dpi, ex-style ${primary.exStyle ?? '?'}; probing ${Math.round(point.x)},${Math.round(point.y)}`,
  );
  const away = { x: host.screenWidth * 0.1, y: host.screenHeight - 120 };
  const morphs = [];
  const seen = app.morphs.length;
  let stall = null;
  let mover = 'input';
  for (let cycle = 0; cycle < count; cycle += 1) {
    let expanded = await expandOnce(app, probe, point, mover);
    if (!expanded.ok && cycle === 0) {
      stall = await stallSnapshot(app, probe, point, 'expand', mover, expanded);
      notes.push(describeStall(stall));
      // Let any hover state the first attempt may have started settle before the retry.
      await moveWith(probe, mover, away);
      await sleep(1500);
      const retryWith = mover === 'input' ? 'cursor' : 'input';
      expanded = await expandOnce(app, probe, point, retryWith);
      if (expanded.ok) {
        stall.recoveredBy = retryWith;
        notes.push(
          `Cycle 1: the strip did not expand from ${MOVER_NAMES[mover]} moves but did from the ${MOVER_NAMES[retryWith]} retry; the remaining cycles used ${MOVER_NAMES[retryWith]}.`,
        );
        mover = retryWith;
      } else {
        stall.retry = { mover: retryWith, error: expanded.error, lastMove: expanded.lastMove };
      }
    }
    if (!expanded.ok) {
      notes.push(
        `Cycle ${cycle + 1}: the strip did not expand (${expanded.error})${stall?.retry ? `, nor after the ${MOVER_NAMES[stall.retry.mover]} retry` : ''}; stopped driving morphs.`,
      );
      break;
    }
    morphs.push(expanded.morph);
    await sleep(400);
    const collapse = app.waitForMorph((m) => m.label === 'notch' && !m.expanded, MORPH_TIMEOUT_MS);
    await moveWith(probe, mover, away);
    try {
      morphs.push(await collapse);
    } catch (error) {
      stall ??= await stallSnapshot(app, probe, away, 'collapse', mover, {
        error: error.message,
        lastMove: null,
      });
      notes.push(
        `Cycle ${cycle + 1}: the panel did not collapse (${error.message}); stopped driving morphs.`,
      );
      break;
    }
    log(
      `cycle ${cycle + 1}/${count}: expand ${morphs[morphs.length - 2].fps} fps, collapse ${morphs[morphs.length - 1].fps} fps`,
    );
    await sleep(600);
  }
  // Include morphs the shell reported on its own during the drive (e.g. hover reveals).
  const all = app.morphs.slice(seen).filter((m) => m.label === 'notch');
  return { morphs: all.length >= morphs.length ? all : morphs, notes, stall };
}

/** Moves the cursor to `{ x, y }` with the given mover. */
function moveWith(probe, mover, { x, y }) {
  return mover === 'input' ? probe.input(x, y) : probe.cursor(x, y);
}

/**
 * One expand attempt: drifts the cursor across `point` with `mover` (`'input'` = SendInput,
 * `'cursor'` = SetCursorPos) until the shell reports the expand morph or the timeout passes.
 * Returns `{ ok, morph }` or `{ ok: false, error }`, plus the last move's answer.
 */
async function expandOnce(app, probe, point, mover) {
  const expand = app.waitForMorph((m) => m.label === 'notch' && m.expanded, MORPH_TIMEOUT_MS);
  const move = (x, y) => moveWith(probe, mover, { x, y });
  let dx = -6;
  let lastMove = null;
  const drift = setInterval(() => {
    dx += 1;
    move(point.x + dx, point.y).then(
      (answer) => {
        lastMove = answer;
      },
      (error) => {
        lastMove = { ok: false, error: error.message };
      },
    );
  }, DRIFT_INTERVAL_MS);
  try {
    const morph = await expand;
    return { ok: true, morph, lastMove };
  } catch (error) {
    return { ok: false, error: error.message, lastMove };
  } finally {
    clearInterval(drift);
  }
}

/** What the desktop looked like when a morph did not arrive; every probe failure is recorded, not thrown. */
async function stallSnapshot(app, probe, point, phase, mover, attempt) {
  const ask = async (query) => {
    try {
      return await query();
    } catch (error) {
      return { error: error.message };
    }
  };
  const requested = { x: Math.round(point.x), y: Math.round(point.y) };
  return {
    phase,
    mover,
    error: attempt.error,
    requested,
    lastMove: attempt.lastMove,
    cursor: await ask(() => probe.cursorPosition()),
    under: await ask(() => probe.point(requested.x, requested.y)),
    foreground: await ask(() => probe.foreground()),
    windows: await ask(() => probe.windows()),
    memoryTarget: app.memoryTarget,
    morphsSoFar: app.morphs.length,
    recentLog: app.recentLog(),
  };
}

function describeRect(rect) {
  return `${rect.left},${rect.top}–${rect.right},${rect.bottom}`;
}

function describeWindow(window) {
  if (!window || window.error) return window?.error ? `probe error: ${window.error}` : 'none';
  if (!window.hwnd) return 'none';
  const bits = [window.caption ? 'caption' : null, window.popup ? 'popup' : null];
  if (window.clickThrough) bits.push('click-through');
  if (window.topmost) bits.push('topmost');
  const rect = window.rect ? ` ${describeRect(window.rect)}` : '';
  return `${window.className || '?'} (${window.processName || `pid ${window.pid}`})${rect}${bits.filter(Boolean).length ? ` [${bits.filter(Boolean).join(', ')}]` : ''}`;
}

/** One readable line for the notes, from a `stallSnapshot`. */
export function describeStall(stall) {
  const via = MOVER_NAMES[stall.mover] ?? stall.mover;
  const moved =
    stall.lastMove === null
      ? 'no move was answered'
      : stall.lastMove.error
        ? `last move failed: ${stall.lastMove.error}`
        : `last move ${stall.lastMove.ok ? 'ok' : 'returned false'}`;
  const cursor = stall.cursor?.error
    ? `cursor unknown (${stall.cursor.error})`
    : `cursor at ${stall.cursor.x},${stall.cursor.y}`;
  const notch = Array.isArray(stall.windows)
    ? stall.windows
        .map(
          (w) =>
            `${describeRect(w)}${w.visible ? '' : ' hidden'}${w.clickThrough ? ' click-through' : ' hit-testable'}`,
        )
        .join('; ') || 'no MunaNotch window'
    : `windows unknown (${stall.windows?.error})`;
  const warnings = stall.recentLog
    .filter((entry) =>
      /WARN|ERROR|cursor poll|click_through|memory target failed/i.test(entry.line),
    )
    .slice(-3)
    .map((entry) => entry.line.replace(/\s+/g, ' ').slice(0, 120));
  return (
    `Stall diagnostics (${stall.phase}, via ${via}): asked for ${stall.requested.x},${stall.requested.y}, ${cursor}, ${moved}; ` +
    `under the point: ${describeWindow(stall.under)}; foreground: ${describeWindow(stall.foreground)}; ` +
    `notch window ${notch}; memory target ${stall.memoryTarget}; ${stall.morphsSoFar} morph lines so far` +
    (warnings.length ? `; shell warnings: ${warnings.join(' | ')}` : '; no shell warnings') +
    '.'
  );
}
