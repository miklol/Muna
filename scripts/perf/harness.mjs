// Runs the app and takes the measurements. Plain Node on top of `probe.ps1` for the Win32
// side; the pure maths and the report live in `report.mjs`.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { repoRoot } from '../lib.mjs';
import { cpuPercent, parseMemoryTargetLine, parseMorphLine, parseReadyLine } from './report.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * Idle window: parks the cursor away from the notch, snapshots CPU time at the start and end
 * of `cpuSeconds`, and samples memory every `memorySampleSeconds` until `memoryAfterSeconds`
 * (counted from launch; `elapsedSeconds` is how far the run already is).
 */
export async function measureIdle(app, probe, host, plan, elapsedSeconds, log) {
  await probe.cursor(host.screenWidth * 0.1, host.screenHeight - 120);
  const treeNow = async () => (await probe.tree(app.pid)).map((p) => p.pid);
  const memorySamples = [];
  const takeMemory = async (atSeconds) => {
    const sample = await probe.sample(await treeNow());
    const sum = totals(sample);
    const memoryTarget = app.memoryTarget;
    memorySamples.push({ atSeconds, memoryTarget, ...sum });
    log(
      `memory at ${String(atSeconds).padStart(3)} s: private ${sum.privateWorkingSetMb.toFixed(1)} MB, working set ${sum.workingSetMb.toFixed(1)} MB over ${sum.processes} processes, ${memoryTarget} target`,
    );
    return sample;
  };

  const before = await probe.sample(await treeNow());
  const cpuStart = performance.now();
  log(`sampling CPU for ${plan.cpuSeconds} s over ${before.length} processes…`);
  let elapsed = elapsedSeconds;
  const cpuEnd = elapsed + plan.cpuSeconds;
  while (elapsed < cpuEnd) {
    const step = Math.min(plan.memorySampleSeconds, cpuEnd - elapsed);
    await sleep(step * 1000);
    elapsed += step;
    if (elapsed < cpuEnd) await takeMemory(elapsed);
  }
  const after = await probe.sample(await treeNow());
  const wallMs = performance.now() - cpuStart;
  const cpu = cpuPercent(before, after, wallMs, host.logicalProcessors);
  log(
    `idle CPU: ${cpu.normalised?.toFixed(3)} % of ${host.logicalProcessors} logical processors (${cpu.raw?.toFixed(2)} % of one core) over ${(wallMs / 1000).toFixed(1)} s`,
  );
  let lastSample = await takeMemory(elapsed);
  while (elapsed < plan.memoryAfterSeconds) {
    const step = Math.min(plan.memorySampleSeconds, plan.memoryAfterSeconds - elapsed);
    await sleep(step * 1000);
    elapsed += step;
    lastSample = await takeMemory(elapsed);
  }
  const last = totals(lastSample);
  const cpuBefore = new Map(before.map((p) => [p.pid, p.cpuMs]));
  const cpuAfter = new Map(after.map((p) => [p.pid, p.cpuMs]));
  return {
    cpu: { ...cpu, wallMs: Math.round(wallMs) },
    memorySamples,
    workingSetMb: Math.round(last.workingSetMb * 10) / 10,
    processes: last.processes,
    processTree: lastSample.map((p) => ({
      pid: p.pid,
      name: p.name,
      privateWorkingSetMb: p.privateWorkingSetMb,
      workingSetMb: p.workingSetMb,
      // CPU time spent during the idle window; `null` when the process appeared afterwards.
      idleCpuMs: cpuAfter.has(p.pid)
        ? Math.round((cpuAfter.get(p.pid) - (cpuBefore.get(p.pid) ?? 0)) * 10) / 10
        : null,
    })),
    elapsedSeconds: elapsed,
  };
}

/**
 * Drives `count` expand/collapse cycles with the real cursor: it lands on the strip and drifts
 * a pixel at a time (well under the hover-intent velocity limit) until the shell reports the
 * expand morph, then parks far away until the collapse morph is reported. Returns the morph
 * records; a cycle that does not morph within its timeout ends the loop with a note.
 */
export async function driveMorphs(app, probe, host, count, log) {
  const notes = [];
  const windows = (await probe.windows()).filter((w) => w.visible);
  const primary = windows.find((w) => w.top >= 0 && w.top < host.screenHeight / 2);
  if (!primary) {
    notes.push(
      'No placed notch window was found (desktop locked or notch parked); morphs were not driven.',
    );
    return { morphs: [], notes };
  }
  const scale = primary.dpi / 96;
  // The strip sits at the top centre of the notch window (200 × 32 logical px).
  const centreX = (primary.left + primary.right) / 2;
  const stripY = primary.top + 14 * scale;
  const awayX = host.screenWidth * 0.1;
  const awayY = host.screenHeight - 120;
  const morphs = [];
  const seen = app.morphs.length;
  for (let cycle = 0; cycle < count; cycle += 1) {
    const expand = app.waitForMorph((m) => m.label === 'notch' && m.expanded, 6000);
    let dx = -6;
    const drift = setInterval(() => {
      dx += 1;
      void probe.cursor(centreX + dx, stripY).catch(() => {});
    }, 60);
    try {
      morphs.push(await expand);
    } catch (error) {
      clearInterval(drift);
      notes.push(
        `Cycle ${cycle + 1}: the strip did not expand (${error.message}); stopped driving morphs.`,
      );
      break;
    } finally {
      clearInterval(drift);
    }
    await sleep(400);
    const collapse = app.waitForMorph((m) => m.label === 'notch' && !m.expanded, 6000);
    await probe.cursor(awayX, awayY);
    try {
      morphs.push(await collapse);
    } catch (error) {
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
  return { morphs: all.length >= morphs.length ? all : morphs, notes };
}
