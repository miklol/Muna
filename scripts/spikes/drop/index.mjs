// Spike S1 (docs/spikes/m4-drop.md): does Tauri's drag-drop path report enter / over / leave
// while an OLE drag crosses the transparent, click-through notch window? Starts the debug
// build with a private profile, runs `drag-source.ps1` twice (cancel, then drop) and moves the
// cursor through the primary strip with the perf probe while the app's log lines are
// timestamped on one clock. Writes the criteria table to stdout and `--out` (JSON).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { repoRoot } from '../../lib.mjs';
import { App, Probe, defaultExe } from '../../perf/harness.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now();

const ENTER_LINE =
  /\[INFO\] drag enter label="(?<label>[^"]*)" count=(?<count>\d+) x=(?<x>-?[\d.]+) y=(?<y>-?[\d.]+)/;
const LEAVE_LINE =
  /\[INFO\] drag leave label="(?<label>[^"]*)" overs=(?<overs>\d+) first=(?<first>\S+) last=(?<last>\S+)/;
const DROP_LINE =
  /\[INFO\] drag drop label="(?<label>[^"]*)" count=(?<count>\d+) x=(?<x>-?[\d.]+) y=(?<y>-?[\d.]+) overs=(?<overs>\d+)/;
const FOCUSED_LINE = /\[WARN\] notch window focused/;

// Shell geometry the driver assumes (docs/modules/notch-shell.md defaults): Notch shape at
// offset 0, 32 CSS px tall, at least 190 CSS px wide, centred in the window.
const STRIP_HEIGHT_CSS = 32;
const STRIP_MIN_WIDTH_CSS = 190;

/** `(x,y)` as the Rust `DragPoint` prints it, or `-`. */
function parsePoint(text) {
  const match = /^\((?<x>-?\d+),(?<y>-?\d+)\)$/.exec(text);
  return match?.groups ? { x: Number(match.groups.x), y: Number(match.groups.y) } : null;
}

function parseArgs(argv) {
  const options = { out: null, verbose: false, exe: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[++i];
    else if (arg === '--exe') options.exe = argv[++i];
    else if (arg === '--verbose') options.verbose = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** Collects the app's drag lines with the driver's clock. */
class DragLog {
  enters = [];
  leaves = [];
  drops = [];
  focused = [];
  #onEvent = new Set();

  record(line, atMs) {
    const enter = ENTER_LINE.exec(line);
    if (enter?.groups) {
      const g = enter.groups;
      this.#push(this.enters, {
        kind: 'enter',
        label: g.label,
        count: Number(g.count),
        x: Number(g.x),
        y: Number(g.y),
        atMs,
      });
      return;
    }
    const leave = LEAVE_LINE.exec(line);
    if (leave?.groups) {
      const g = leave.groups;
      this.#push(this.leaves, {
        kind: 'leave',
        label: g.label,
        overs: Number(g.overs),
        first: parsePoint(g.first),
        last: parsePoint(g.last),
        atMs,
      });
      return;
    }
    const drop = DROP_LINE.exec(line);
    if (drop?.groups) {
      const g = drop.groups;
      this.#push(this.drops, {
        kind: 'drop',
        label: g.label,
        count: Number(g.count),
        x: Number(g.x),
        y: Number(g.y),
        overs: Number(g.overs),
        atMs,
      });
      return;
    }
    if (FOCUSED_LINE.test(line)) this.#push(this.focused, { kind: 'focused', atMs });
  }

  #push(list, record) {
    list.push(record);
    for (const listener of this.#onEvent) listener(record);
  }

  /** Resolves with the next record of `kind` recorded after now, or `null` on timeout. */
  next(kind, timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#onEvent.delete(listener);
        resolve(null);
      }, timeoutMs);
      const listener = (record) => {
        if (record.kind !== kind) return;
        clearTimeout(timer);
        this.#onEvent.delete(listener);
        resolve(record);
      };
      this.#onEvent.add(listener);
    });
  }
}

/** One `drag-source.ps1` run; resolves its phases as they arrive. */
class DragSource {
  #child;
  phases = [];
  #waiters = new Set();
  exited = false;

  constructor(file, start, holdMs, mode, log) {
    const script = path.join(repoRoot, 'scripts', 'spikes', 'drop', 'drag-source.ps1');
    this.#child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-Path',
        file,
        '-StartX',
        String(Math.round(start.x)),
        '-StartY',
        String(Math.round(start.y)),
        '-HoldMs',
        String(holdMs),
        '-Mode',
        mode,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      log?.(`  [source] ${line}`);
      let phase;
      try {
        phase = JSON.parse(line);
      } catch {
        return;
      }
      phase.atMs = now();
      this.phases.push(phase);
      for (const waiter of this.#waiters) waiter(phase);
    });
    this.#child.once('exit', () => {
      this.exited = true;
      for (const waiter of this.#waiters) waiter({ phase: 'exit', atMs: now() });
    });
  }

  /** Resolves with the first phase named `name` (already seen or upcoming), or rejects. */
  waitFor(name, timeoutMs) {
    const existing = this.phases.find((p) => p.phase === name);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(waiter);
        reject(new Error(`drag source: no "${name}" within ${timeoutMs} ms`));
      }, timeoutMs);
      const waiter = (phase) => {
        if (phase.phase === name) {
          clearTimeout(timer);
          this.#waiters.delete(waiter);
          resolve(phase);
        } else if (phase.phase === 'error' || phase.phase === 'exit') {
          clearTimeout(timer);
          this.#waiters.delete(waiter);
          reject(new Error(`drag source ${phase.phase}: ${phase.message ?? 'exited early'}`));
        }
      };
      this.#waiters.add(waiter);
    });
  }

  kill() {
    if (!this.exited) this.#child.kill();
  }
}

/** The notch window on the primary monitor (origin 0,0) and the strip rect inside it. */
function primaryGeometry(windows, host) {
  const centreX = host.screenWidth / 2;
  const window = windows.find(
    (w) => w.visible && w.left <= centreX && centreX <= w.right && w.top <= 0 && 0 < w.bottom,
  );
  if (!window) {
    throw new Error(
      `no visible MunaNotch window spans the primary top-centre (${centreX}, 0): ${JSON.stringify(windows)}`,
    );
  }
  const scale = window.dpi / 96;
  const cx = (window.left + window.right) / 2;
  const strip = {
    left: cx - (STRIP_MIN_WIDTH_CSS / 2) * scale,
    right: cx + (STRIP_MIN_WIDTH_CSS / 2) * scale,
    top: window.top,
    bottom: window.top + STRIP_HEIGHT_CSS * scale,
  };
  return { window, scale, cx, strip };
}

const inside = (rect, x, y) =>
  rect.left <= x && x <= rect.right && rect.top <= y && y <= rect.bottom;

/**
 * Moves the cursor in `steps` straight-line hops from `from` to `to`, `stepMs` apart, and
 * returns the driver timestamp of the first hop for which `mark(x, y)` is true (or `null`).
 */
async function glide(probe, from, to, steps, stepMs, mark) {
  let marked = null;
  for (let i = 1; i <= steps; i += 1) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await probe.cursor(x, y);
    const at = now();
    if (marked === null && mark?.(x, y)) marked = at;
    await sleep(stepMs);
  }
  return marked;
}

/** Holds the cursor around `at` for `ms`, one pixel of jitter every 50 ms (OLE re-targets on moves). */
async function dwell(probe, at, ms) {
  const until = now() + ms;
  let i = 0;
  while (now() < until) {
    await probe.cursor(at.x + (i % 2), at.y + ((i >> 1) % 2));
    i += 1;
    await sleep(50);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const log = (message) => console.log(`[drop-spike] ${message}`);
  const verbose = options.verbose ? (line) => console.log(`  ${line}`) : undefined;

  const exe = options.exe ? { path: options.exe, profile: 'custom' } : defaultExe();
  if (!existsSync(exe.path)) {
    throw new Error(
      `${exe.path} not found — run "pnpm --filter @muna/desktop tauri build --debug --no-bundle" first`,
    );
  }

  const probe = new Probe();
  await probe.ready;
  const host = await probe.host();
  log(`host: ${host.os}, primary ${host.screenWidth}×${host.screenHeight}`);
  // Restored at the end: a cursor left inside a notch window keeps the shell's 60 Hz poll and
  // the normal memory target alive, which skews any perf run that follows.
  const cursorBefore = await probe.cursorPosition();
  let parkCursor = { x: cursorBefore.x, y: cursorBefore.y };

  const scratch = mkdtempSync(path.join(tmpdir(), 'muna-drop-spike-'));
  const file = path.join(scratch, 'dropped.txt');
  writeFileSync(file, 'Muna drop spike\n');

  const drag = new DragLog();
  const t0 = now();
  const app = new App(exe.path, {
    log: (line) => {
      verbose?.(line);
      drag.record(line, now());
    },
  });
  let source = null;
  const result = {
    host,
    exe,
    startedAtIso: new Date().toISOString(),
    passes: [],
    criteria: [],
  };

  try {
    const ready = await app.waitForReady('notch', 30_000);
    log(`shell ready after ${ready.atMs} ms; settling 1.5 s`);
    await sleep(1500);

    const geometry = primaryGeometry(await probe.windows(), host);
    const { window, scale, cx, strip } = geometry;
    log(
      `primary notch window ${window.left},${window.top}–${window.right},${window.bottom} (scale ${scale}); strip ≈ ${Math.round(strip.left)}–${Math.round(strip.right)} × ${strip.top}–${Math.round(strip.bottom)}`,
    );
    const target = { x: cx, y: strip.top + 14 * scale };
    const start = { x: cx, y: strip.top + 400 * scale };
    const windowRect = {
      left: 0,
      top: 0,
      right: window.right - window.left,
      bottom: window.bottom - window.top,
    };
    result.geometry = { window, scale, strip, target, start };
    if (inside(window, parkCursor.x, parkCursor.y)) {
      parkCursor = { x: cx, y: Math.min(window.bottom + 200, host.screenHeight - 1) };
    }

    const foregroundBefore = await probe.foreground();
    result.foregroundBefore = foregroundBefore;

    // Pass 1: in, dwell, out, cancel.
    {
      log('pass 1: enter, dwell, leave, cancel');
      const holdMs = 2600;
      source = new DragSource(file, start, holdMs, 'cancel', verbose);
      await source.waitFor('started', 10_000);
      await sleep(150);
      const entered = drag.next('enter', 5_000);
      const insideAt = await glide(probe, start, target, 12, 16, (x, y) => inside(strip, x, y));
      const enter = await entered;
      const overDwell = 600;
      await dwell(probe, target, overDwell);
      const left = drag.next('leave', 5_000);
      const outAt = await glide(probe, target, start, 12, 16, (x, y) => !inside(strip, x, y));
      const leave = await left;
      await dwell(probe, start, 500);
      const ended = await source.waitFor('ended', 10_000);
      source = null;
      const foreground = await probe.foreground();
      result.passes.push({
        name: 'cancel',
        cursorInsideStripAtMs: insideAt,
        cursorOutAtMs: outAt,
        enter,
        leave,
        source: ended,
        foregroundAfter: foreground,
        focused: drag.focused.length,
      });
      const enterLatency = enter && insideAt !== null ? enter.atMs - insideAt : null;
      const leaveLatency = leave && outAt !== null ? leave.atMs - outAt : null;
      log(
        `  enter ${enter ? `after ${enterLatency?.toFixed(0)} ms (count ${enter.count}, at ${enter.x},${enter.y})` : 'never arrived'}`,
      );
      log(
        `  leave ${leave ? `after ${leaveLatency?.toFixed(0)} ms (overs ${leave.overs}, first ${JSON.stringify(leave.first)}, last ${JSON.stringify(leave.last)})` : 'never arrived'}`,
      );
      log(
        `  source ended: effect ${ended.effect}, ${ended.queries} queries, ${ended.elapsedMs} ms`,
      );

      result.criteria.push(
        {
          id: 'D1',
          name: 'enter arrives once the cursor is over the strip',
          budget: '≤ 100 ms',
          measured: enterLatency === null ? 'no enter' : `${enterLatency.toFixed(0)} ms`,
          pass: enterLatency !== null && enterLatency <= 100,
        },
        {
          id: 'D2',
          name: 'over carries coordinates',
          budget: `≥ 3 overs in ${overDwell} ms, first and last inside the client rect`,
          measured: leave
            ? `${leave.overs} overs, first ${JSON.stringify(leave.first)}, last ${JSON.stringify(leave.last)}`
            : 'no leave',
          pass:
            !!leave &&
            leave.overs >= 3 &&
            !!leave.first &&
            !!leave.last &&
            inside(windowRect, leave.first.x, leave.first.y) &&
            inside(windowRect, leave.last.x, leave.last.y),
        },
        {
          id: 'D3',
          name: 'leave arrives once the cursor is out',
          budget: '≤ 100 ms',
          measured: leaveLatency === null ? 'no leave' : `${leaveLatency.toFixed(0)} ms`,
          pass: leaveLatency !== null && leaveLatency <= 100,
        },
      );
    }

    await sleep(800);

    // Pass 2: in, dwell, drop.
    {
      log('pass 2: enter, dwell, drop');
      const holdMs = 1400;
      source = new DragSource(file, start, holdMs, 'drop', verbose);
      await source.waitFor('started', 10_000);
      await sleep(150);
      const entered = drag.next('enter', 5_000);
      await glide(probe, start, target, 12, 16, (x, y) => inside(strip, x, y));
      const enter = await entered;
      const dropped = drag.next('drop', 6_000);
      const ended = source.waitFor('ended', 10_000);
      // Keep jittering until the source decides to drop.
      const deadline = now() + 4_000;
      let i = 0;
      while (now() < deadline && !source.phases.some((p) => p.phase === 'ended')) {
        await probe.cursor(target.x + (i % 2), target.y + ((i >> 1) % 2));
        i += 1;
        await sleep(50);
      }
      const end = await ended;
      const drop = await dropped;
      source = null;
      const foreground = await probe.foreground();
      result.passes.push({
        name: 'drop',
        enter,
        drop,
        source: end,
        foregroundAfter: foreground,
        focused: drag.focused.length,
      });
      log(
        `  drop ${drop ? `count ${drop.count} at ${drop.x},${drop.y} after ${drop.overs} overs` : 'never arrived'}; source effect ${end.effect}`,
      );
      result.criteria.push({
        id: 'D5',
        name: 'drop delivers the items',
        budget: 'count 1, position inside the client rect, source sees Copy',
        measured: drop
          ? `count ${drop.count} at (${drop.x},${drop.y}); effect ${end.effect}`
          : `no drop; effect ${end.effect}`,
        pass:
          !!drop && drop.count === 1 && inside(windowRect, drop.x, drop.y) && end.effect === 'Copy',
      });
    }

    const foregroundClasses = result.passes.map((p) => p.foregroundAfter.className);
    result.criteria.push({
      id: 'D4',
      name: 'the strip never activates',
      budget: 'no "notch window focused" line; foreground never MunaNotch',
      measured: `${drag.focused.length} focus line(s); foreground before "${foregroundBefore.className}", after ${foregroundClasses.map((c) => `"${c}"`).join(', ')}`,
      pass: drag.focused.length === 0 && !foregroundClasses.includes('MunaNotch'),
    });
    // Sort D1..D5 by id for the table.
    result.criteria.sort((a, b) => a.id.localeCompare(b.id));
  } finally {
    source?.kill();
    await probe.cursor(parkCursor.x, parkCursor.y).catch(() => {});
    await app.stop();
    probe.close();
    rmSync(scratch, { recursive: true, force: true });
  }

  result.durationMs = Math.round(now() - t0);
  const lines = [
    '| # | Criterion | Budget | Measured | Result |',
    '| --- | --- | --- | --- | --- |',
    ...result.criteria.map(
      (c) => `| ${c.id} | ${c.name} | ${c.budget} | ${c.measured} | ${c.pass ? 'pass' : 'fail'} |`,
    ),
  ];
  console.log(`\n${lines.join('\n')}\n`);
  if (options.out) {
    mkdirSync(path.dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
    log(`wrote ${options.out}`);
  }
  const failed = result.criteria.filter((c) => !c.pass);
  if (failed.length > 0) {
    log(`${failed.length} criterion/criteria failed: ${failed.map((c) => c.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    log('all criteria pass');
  }
}

main().catch((error) => {
  console.error(`[drop-spike] ${error.message}`);
  process.exitCode = 1;
});
