// Spike S2 (docs/spikes/m4-drag.md): can a pointer gesture that starts inside the WebView2 be
// handed to OLE (`SHDoDragDrop` on the main thread from a Tauri command) so a file lands in
// Explorer and in a browser's file input? Starts the debug build with a private profile and
// `MUNA_SPIKE=drag`, opens the targets at known positions, drives real `SendInput` gestures
// through `probe.ps1` and timestamps the app's log lines on the driver's clock. Writes the
// criteria table to stdout and `--out` (JSON).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { repoRoot } from '../../lib.mjs';
import { App, Probe, defaultExe } from '../../perf/harness.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const now = () => performance.now();

const ARMED_LINE = /\[INFO\] drag spike armed label="(?<label>[^"]*)" files=(?<files>\d+)/;
const REQUESTED_LINE = /\[INFO\] drag out requested label="(?<label>[^"]*)" items=(?<items>\d+)/;
const STARTED_LINE = /\[INFO\] drag out started wait_ms=(?<wait>\d+)/;
const FINISHED_LINE =
  /\[INFO\] drag out finished dropped=(?<dropped>true|false) effect="(?<effect>\w+)" ms=(?<ms>\d+)/;
const FAILED_LINE = /\[WARN\] drag out failed error=(?<error>.*) ms=(?<ms>\d+)/;
const HTML5_LINE = /\[WARN\] ui .*drag out html5 dragstart/;
const FOCUSED_LINE = /\[WARN\] notch window focused/;
const DROP_ENTER_LINE = /\[INFO\] drag enter label=/;

// Shell geometry the driver assumes (docs/modules/notch-shell.md defaults): Notch shape at
// offset 0, 32 CSS px tall, at least 190 CSS px wide, centred in the window.
const STRIP_HEIGHT_CSS = 32;
const STRIP_MIN_WIDTH_CSS = 190;
const DRAGGED_NAME = 'muna-s2-drag.txt';
/** Resting on the lip this long covers the poll's 100 ms sample, hoverIntent (250 ms) and the reveal morph. */
const HOVER_REVEAL_MS = 900;

function parseArgs(argv) {
  const options = { out: null, verbose: false, exe: null, skipEdge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') options.out = argv[++i];
    else if (arg === '--exe') options.exe = argv[++i];
    else if (arg === '--verbose') options.verbose = true;
    else if (arg === '--skip-edge') options.skipEdge = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** Collects the app's drag-out lines with the driver's clock. */
class DragLog {
  records = [];
  #onEvent = new Set();

  record(line, atMs) {
    let record = null;
    let m;
    if ((m = ARMED_LINE.exec(line))?.groups) {
      record = { kind: 'armed', label: m.groups.label, files: Number(m.groups.files) };
    } else if ((m = REQUESTED_LINE.exec(line))?.groups) {
      record = { kind: 'requested', label: m.groups.label, items: Number(m.groups.items) };
    } else if ((m = STARTED_LINE.exec(line))?.groups) {
      record = { kind: 'started', waitMs: Number(m.groups.wait) };
    } else if ((m = FINISHED_LINE.exec(line))?.groups) {
      record = {
        kind: 'finished',
        dropped: m.groups.dropped === 'true',
        effect: m.groups.effect,
        ms: Number(m.groups.ms),
      };
    } else if ((m = FAILED_LINE.exec(line))?.groups) {
      record = { kind: 'finished', failed: true, error: m.groups.error, ms: Number(m.groups.ms) };
    } else if (HTML5_LINE.test(line)) {
      record = { kind: 'html5' };
    } else if (FOCUSED_LINE.test(line)) {
      record = { kind: 'focused' };
    } else if (DROP_ENTER_LINE.test(line)) {
      record = { kind: 'selfDropEnter' };
    }
    if (record === null) return;
    record.atMs = atMs;
    this.records.push(record);
    for (const listener of this.#onEvent) listener(record);
  }

  count(kind) {
    return this.records.filter((r) => r.kind === kind).length;
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

/** Long-lived `probe.ps1` for the targets and the gesture; phase lines arrive between answers. */
class DragProbe {
  #child;
  #queue = [];
  #closed = false;
  phases = [];
  #onPhase = new Set();

  constructor(log) {
    const script = path.join(repoRoot, 'scripts', 'spikes', 'drag', 'probe.ps1');
    this.#child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'pipe', 'inherit'] },
    );
    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      log?.(`  [probe] ${line}`);
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        return;
      }
      if (value && typeof value === 'object' && 'phase' in value) {
        const phase = { ...value, atMs: now() };
        this.phases.push(phase);
        for (const listener of this.#onPhase) listener(phase);
        return;
      }
      const waiter = this.#queue.shift();
      if (waiter) waiter(value);
    });
    this.#child.once('exit', () => {
      this.#closed = true;
      for (const waiter of this.#queue.splice(0)) waiter({ error: 'probe exited' });
    });
    this.ready = this.#send(null);
  }

  #send(command, timeoutMs = 60_000) {
    if (this.#closed) return Promise.reject(new Error('drag probe exited'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`drag probe timed out on '${command ?? 'ready'}'`)),
        timeoutMs,
      );
      this.#queue.push((value) => {
        clearTimeout(timer);
        if (value && typeof value === 'object' && 'error' in value) {
          reject(new Error(`drag probe: ${value.error}`));
        } else {
          resolve(value);
        }
      });
      if (command !== null) this.#child.stdin.write(`${command}\n`);
    });
  }

  explorer(folder, x, y, w, h) {
    return this.#send(`explorer ${folder} ${x} ${y} ${w} ${h}`);
  }

  edge(page, x, y, w, h) {
    return this.#send(`edge ${page} ${x} ${y} ${w} ${h}`);
  }

  title(hwnd) {
    return this.#send(`title ${hwnd}`);
  }

  /** Rests the cursor at `point` for `ms` (with a one-pixel jitter so the webview sees moves). */
  hover(point, ms) {
    return this.#send(`hover ${Math.round(point.x)} ${Math.round(point.y)} ${ms}`);
  }

  /** The top-level window that owns the pointer at `point`. */
  under(point) {
    return this.#send(`under ${Math.round(point.x)} ${Math.round(point.y)}`);
  }

  /** A plain press and release at `point` that never becomes a drag. */
  click(point) {
    return this.#send(`click ${Math.round(point.x)} ${Math.round(point.y)}`);
  }

  /** Runs the gesture; resolves when the button is up again. Phases land in `phases`. */
  drag(from, to, holdMs) {
    this.phases.length = 0;
    return this.#send(
      `drag ${Math.round(from.x)} ${Math.round(from.y)} ${Math.round(to.x)} ${Math.round(to.y)} ${holdMs}`,
    );
  }

  close(hwnd) {
    return this.#send(`close ${hwnd}`);
  }

  kill(pid) {
    return this.#send(`kill ${pid}`);
  }

  phase(name) {
    return this.phases.find((p) => p.phase === name) ?? null;
  }

  quit() {
    if (!this.#closed) {
      this.#child.stdin.write('quit\n');
      this.#child.stdin.end();
    }
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

/** Polls `predicate` every 100 ms until it is truthy or `timeoutMs` passed; `null` on timeout. */
async function waitUntil(predicate, timeoutMs) {
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    const value = await predicate();
    if (value) return { value, atMs: now() };
    await sleep(100);
  }
  return null;
}

const fmt = (ms) => (ms === null ? '-' : `${ms.toFixed(0)} ms`);

/** Removes a directory a just-killed process may still hold for a moment; gives up quietly. */
async function removeLater(dir) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await sleep(300);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const log = (message) => console.log(`[drag-spike] ${message}`);
  const verbose = options.verbose ? (line) => console.log(`  ${line}`) : undefined;

  const exe = options.exe ? { path: options.exe, profile: 'custom' } : defaultExe();
  if (!existsSync(exe.path)) {
    throw new Error(
      `${exe.path} not found — run "pnpm --filter @muna/desktop tauri build --debug --no-bundle" first`,
    );
  }

  const probe = new Probe();
  const targets = new DragProbe(verbose);
  await Promise.all([probe.ready, targets.ready]);
  const host = await probe.host();
  log(`host: ${host.os}, primary ${host.screenWidth}×${host.screenHeight}`);
  // Restored at the end: a cursor left inside a notch window keeps the shell's 60 Hz poll and
  // the normal memory target alive, which skews any perf run that follows.
  const cursorBefore = await probe.cursorPosition();
  let parkCursor = { x: cursorBefore.x, y: cursorBefore.y };

  const scratch = mkdtempSync(path.join(tmpdir(), 'muna-drag-spike-'));
  const dragged = path.join(scratch, DRAGGED_NAME);
  writeFileSync(dragged, 'Muna drag-out spike\n');
  const folders = ['explorer-1', 'explorer-4'].map((name) => {
    const folder = path.join(scratch, name);
    mkdirSync(folder);
    return folder;
  });
  const page = path.join(repoRoot, 'scripts', 'spikes', 'drag', 'target.html');

  process.env.MUNA_SPIKE = 'drag';
  process.env.MUNA_SPIKE_DRAG_FILE = dragged;
  const drag = new DragLog();
  const t0 = now();
  const app = new App(exe.path, {
    log: (line) => {
      verbose?.(line);
      drag.record(line, now());
    },
  });
  const opened = { explorer: [], edge: null };
  const result = {
    host,
    exe,
    startedAtIso: new Date().toISOString(),
    passes: [],
    criteria: [],
  };

  /**
   * The target must own the pointer at the drop point, or the drop lands on whatever sits in
   * front of it (a maximised app behind the notch takes file drops too, with effect copy).
   */
  async function expectTargetAt(point, target, what) {
    const under = await targets.under(point);
    if (under.hwnd !== target.hwnd) {
      throw new Error(
        `${what} does not own the drop point ${Math.round(point.x)},${Math.round(point.y)}: "${under.class}" (${under.process ?? '?'}, pid ${under.pid}) is in front`,
      );
    }
  }

  /**
   * One gesture from the strip to `to`; returns the timings the criteria read. The hand first
   * rests on the strip's top edge: a foreground window whose caption overlaps the strip leaves
   * the notch peeking (a 6 px lip), and only a hover reveals it enough to grab.
   */
  async function gesture(name, to, holdMs, start, lip) {
    const requestedBefore = drag.count('requested');
    const finishedBefore = drag.count('finished');
    const focusedBefore = drag.count('focused');
    const started = drag.next('started', 8_000);
    const finished = drag.next('finished', 15_000);
    const rested = await targets.hover(lip, HOVER_REVEAL_MS);
    if (rested.under?.class !== 'MunaNotch') {
      const under = rested.under ?? {};
      throw new Error(
        `another window owns the pointer over the strip: class "${under.class}" (${under.process ?? '?'}, pid ${under.pid}) — a second notch utility or overlay is in the way; close it and rerun`,
      );
    }
    await targets.drag(start, to, holdMs);
    const upAt = targets.phase('up')?.atMs ?? null;
    const thresholdAt = targets.phase('threshold')?.atMs ?? null;
    const startRecord = await started;
    const finishRecord = await finished;
    const pass = {
      name,
      to,
      thresholdAtMs: thresholdAt,
      upAtMs: upAt,
      requested: drag.count('requested') - requestedBefore,
      started: startRecord,
      finished: finishRecord,
      finishedCount: drag.count('finished') - finishedBefore,
      focusLines: drag.count('focused') - focusedBefore,
      startLatencyMs: startRecord && thresholdAt !== null ? startRecord.atMs - thresholdAt : null,
      returnedAfterReleaseMs: finishRecord && upAt !== null ? finishRecord.atMs - upAt : null,
    };
    log(
      `  requested ${pass.requested}×; started ${startRecord ? `after ${fmt(pass.startLatencyMs)} (queued ${startRecord.waitMs} ms)` : 'never'}; finished ${
        finishRecord
          ? finishRecord.failed
            ? `FAILED ${finishRecord.error}`
            : `${finishRecord.dropped ? `dropped (${finishRecord.effect})` : 'cancelled'} after ${finishRecord.ms} ms, ${fmt(pass.returnedAfterReleaseMs)} after the release`
          : 'never'
      }; ${pass.focusLines} focus line(s)`,
    );
    return pass;
  }

  try {
    const ready = await app.waitForReady('notch', 30_000);
    log(`shell ready after ${ready.atMs} ms`);
    const armed = drag.records.find((r) => r.kind === 'armed') ?? (await drag.next('armed', 5_000));
    if (!armed)
      throw new Error('the shell never logged "drag spike armed" — is MUNA_SPIKE honoured?');
    log(`drag spike armed (${armed.files} file); settling 1.5 s`);
    await sleep(1500);

    const geometry = primaryGeometry(await probe.windows(), host);
    const { window, scale, cx, strip } = geometry;
    log(
      `primary notch window ${window.left},${window.top}–${window.right},${window.bottom} (scale ${scale}); strip ≈ ${Math.round(strip.left)}–${Math.round(strip.right)} × ${strip.top}–${Math.round(strip.bottom)}`,
    );
    const start = { x: cx, y: strip.top + 14 * scale };
    // The strip's top edge is on screen in every yield state (docs/modules/notch-shell.md,
    // Peek keeps a 6 px lip), so the hover that reveals it lands there.
    const lip = { x: cx, y: strip.top + 3 * scale };
    // Targets sit below the notch window's bottom edge where nothing of Muna's is in the way.
    const targetSize = { w: Math.round(720 * scale), h: Math.round(480 * scale) };
    const targetPos = {
      x: Math.round(cx - targetSize.w / 2),
      y: Math.min(Math.round(strip.bottom + 120 * scale), host.screenHeight - targetSize.h - 40),
    };
    result.geometry = { window, scale, strip, lip, start, targetPos, targetSize };
    if (
      parkCursor.x >= window.left &&
      parkCursor.x <= window.right &&
      parkCursor.y >= window.top &&
      parkCursor.y <= window.bottom
    ) {
      parkCursor = { x: cx, y: Math.min(window.bottom + 200, host.screenHeight - 1) };
    }
    const foregroundBefore = await probe.foreground();
    result.foregroundBefore = foregroundBefore;
    const foregrounds = [];

    // Control: a plain press on the strip, no drag. WebView2 calls SetFocus on any press, so
    // a `notch window focused` line here is the shell's baseline, not the drag's doing.
    {
      log('control: press and release on the strip');
      await targets.hover(lip, HOVER_REVEAL_MS);
      const focusBefore = drag.count('focused');
      await targets.click(start);
      await sleep(600);
      result.control = {
        focusLines: drag.count('focused') - focusBefore,
        foreground: (await probe.foreground()).className,
      };
      log(
        `  ${result.control.focusLines} focus line(s); foreground "${result.control.foreground}"`,
      );
      await targets.hover(parkCursor, 200);
      await sleep(1_000);
    }
    const focusAfterControl = drag.count('focused');

    // Pass 1: Explorer receives the file (G1, G2, G3).
    {
      log('pass 1: drag to Explorer');
      const explorer = await targets.explorer(
        folders[0],
        targetPos.x,
        targetPos.y,
        targetSize.w,
        targetSize.h,
      );
      opened.explorer.push(explorer.hwnd);
      // The file list: right of the navigation pane, below the command bar.
      const to = {
        x: explorer.left + (explorer.right - explorer.left) * 0.68,
        y: explorer.top + (explorer.bottom - explorer.top) * 0.62,
      };
      await sleep(800);
      await expectTargetAt(to, explorer, 'the Explorer window');
      const pass = await gesture('explorer', to, 300, start, lip);
      const landed = await waitUntil(() => existsSync(path.join(folders[0], DRAGGED_NAME)), 2_000);
      pass.landedAfterReleaseMs = landed && pass.upAtMs !== null ? landed.atMs - pass.upAtMs : null;
      pass.folder = readdirSync(folders[0]);
      log(
        `  Explorer folder now: [${pass.folder.join(', ')}] ${landed ? `(${fmt(pass.landedAfterReleaseMs)} after the release)` : '(nothing landed within 2 s)'}`,
      );
      foregrounds.push((await probe.foreground()).className);
      result.passes.push(pass);
      await targets.close(explorer.hwnd);
      await sleep(600);

      result.criteria.push(
        {
          id: 'G1',
          name: 'the gesture reaches OLE while the button is down',
          budget:
            '`drag out started` ≤ 100 ms after the 6 px hop; DoDragDrop returns only after the release',
          measured: `${fmt(pass.startLatencyMs)}; returned ${fmt(pass.returnedAfterReleaseMs)} after the release`,
          pass:
            pass.startLatencyMs !== null &&
            pass.startLatencyMs <= 100 &&
            pass.returnedAfterReleaseMs !== null &&
            pass.returnedAfterReleaseMs >= 0,
        },
        {
          id: 'G2',
          name: 'the drag follows the cursor out of the notch window',
          budget: 'the drop lands in Explorer (no freeze at the window edge)',
          measured: landed ? 'landed' : 'did not land',
          pass: landed !== null,
        },
        {
          id: 'G3',
          name: 'Explorer receives the file',
          budget: 'file in the folder ≤ 2 s after the release; outcome dropped, effect copy',
          measured: `${landed ? fmt(pass.landedAfterReleaseMs) : 'no file'}; ${pass.finished ? (pass.finished.failed ? 'failed' : `${pass.finished.dropped ? 'dropped' : 'cancelled'} ${pass.finished.effect ?? ''}`) : 'no finish line'}`,
          pass:
            landed !== null &&
            pass.landedAfterReleaseMs <= 2_000 &&
            !!pass.finished &&
            pass.finished.dropped === true &&
            pass.finished.effect === 'copy',
        },
      );
    }

    // Pass 2: a browser file input receives the file (G4).
    {
      log(options.skipEdge ? 'pass 2: skipped (--skip-edge)' : 'pass 2: drag to Edge');
      let measured = 'skipped';
      let pass = null;
      let skipped = options.skipEdge;
      if (!options.skipEdge) {
        const edge = await targets.edge(page, targetPos.x, targetPos.y, targetSize.w, targetSize.h);
        if (edge.skip) {
          skipped = true;
          measured = `skipped: ${edge.skip}`;
          log(`  ${measured}`);
        } else {
          opened.edge = edge;
          const to = {
            x: edge.left + (edge.right - edge.left) / 2,
            y: edge.top + (edge.bottom - edge.top) / 2,
          };
          await sleep(800);
          await expectTargetAt(to, edge, 'the Edge window');
          const gesturePass = await gesture('edge', to, 300, start, lip);
          const titled = await waitUntil(async () => {
            const { title } = await targets.title(edge.hwnd);
            return title.startsWith('S2:') && !title.startsWith('S2:ready') ? title : null;
          }, 2_000);
          gesturePass.title = titled?.value ?? (await targets.title(edge.hwnd)).title;
          gesturePass.titledAfterReleaseMs =
            titled && gesturePass.upAtMs !== null ? titled.atMs - gesturePass.upAtMs : null;
          log(
            `  Edge title: "${gesturePass.title}" ${titled ? `(${fmt(gesturePass.titledAfterReleaseMs)} after the release)` : '(unchanged within 2 s)'}`,
          );
          foregrounds.push((await probe.foreground()).className);
          pass = gesturePass;
          result.passes.push(pass);
          measured = `title "${pass.title}" ${titled ? fmt(pass.titledAfterReleaseMs) : 'never'} after the release`;
          await targets.kill(edge.pid);
          opened.edge = null;
          await removeLater(edge.profile);
          await sleep(600);
        }
      }
      result.criteria.push({
        id: 'G4',
        name: "a browser's file input receives the file",
        budget: 'Edge title becomes S2:<name> ≤ 2 s after the release',
        measured,
        pass: skipped
          ? 'skip'
          : !!pass?.title?.startsWith(`S2:${DRAGGED_NAME}`) && pass.titledAfterReleaseMs <= 2_000,
      });
    }

    // Pass 3: release back over the notch (G7 first half).
    let pass3;
    {
      log('pass 3: release back over the strip');
      const to = { x: cx + 40 * scale, y: strip.top + 12 * scale };
      const selfDropsBefore = drag.count('selfDropEnter');
      pass3 = await gesture('cancel', to, 300, start, lip);
      pass3.selfDropEnters = drag.count('selfDropEnter') - selfDropsBefore;
      pass3.scratch = readdirSync(scratch).filter((name) => !name.startsWith('explorer-'));
      log(
        `  own drop enters: ${pass3.selfDropEnters}; scratch files: [${pass3.scratch.join(', ')}]`,
      );
      foregrounds.push((await probe.foreground()).className);
      result.passes.push(pass3);
      await sleep(600);
    }

    // Pass 4: pass 1 again, proving the shell is still responsive (G7 second half).
    let pass4;
    let landed4;
    {
      log('pass 4: drag to a fresh Explorer window');
      const explorer = await targets.explorer(
        folders[1],
        targetPos.x,
        targetPos.y,
        targetSize.w,
        targetSize.h,
      );
      opened.explorer.push(explorer.hwnd);
      const to = {
        x: explorer.left + (explorer.right - explorer.left) * 0.68,
        y: explorer.top + (explorer.bottom - explorer.top) * 0.62,
      };
      await sleep(800);
      await expectTargetAt(to, explorer, 'the second Explorer window');
      pass4 = await gesture('explorer-again', to, 300, start, lip);
      landed4 = await waitUntil(() => existsSync(path.join(folders[1], DRAGGED_NAME)), 2_000);
      pass4.landedAfterReleaseMs =
        landed4 && pass4.upAtMs !== null ? landed4.atMs - pass4.upAtMs : null;
      pass4.folder = readdirSync(folders[1]);
      log(`  Explorer folder now: [${pass4.folder.join(', ')}]`);
      foregrounds.push((await probe.foreground()).className);
      result.passes.push(pass4);
      await targets.close(explorer.hwnd);
      await sleep(400);
    }

    result.criteria.push(
      {
        id: 'G5',
        name: 'the webview starts no drag of its own',
        budget: 'no `drag out html5 dragstart` line in any pass',
        measured: `${drag.count('html5')} line(s)`,
        pass: drag.count('html5') === 0,
      },
      {
        id: 'G6',
        name: 'the strip never activates',
        budget:
          'per drag pass no more `notch window focused` lines than a plain press (control); foreground never MunaNotch',
        measured: `control ${result.control.focusLines} focus line(s); drag passes ${drag.count('focused') - focusAfterControl} over ${result.passes.length}; foreground before "${foregroundBefore.className}", after ${foregrounds.map((c) => `"${c}"`).join(', ')}`,
        pass:
          drag.count('focused') - focusAfterControl <=
            result.control.focusLines * result.passes.length &&
          result.control.foreground !== 'MunaNotch' &&
          !foregrounds.includes('MunaNotch'),
      },
      {
        id: 'G7',
        name: 'cancel is clean',
        budget:
          'pass 3 ends cancelled or dropped with no copy; the file is not duplicated; pass 4 lands like pass 1',
        measured: `pass 3: ${pass3.finished ? (pass3.finished.failed ? 'failed' : pass3.finished.dropped ? `dropped (${pass3.finished.effect})` : 'cancelled') : 'no finish line'}, ${pass3.selfDropEnters} own drop enter(s), scratch [${pass3.scratch.join(', ')}]; pass 4: ${landed4 ? `landed ${fmt(pass4.landedAfterReleaseMs)} after the release` : 'did not land'}`,
        pass:
          !!pass3.finished &&
          !pass3.finished.failed &&
          pass3.scratch.length === 1 &&
          landed4 !== null &&
          !!pass4.finished &&
          pass4.finished.dropped === true,
      },
    );
    result.criteria.sort((a, b) => a.id.localeCompare(b.id));
  } finally {
    for (const hwnd of opened.explorer) await targets.close(hwnd).catch(() => {});
    if (opened.edge) {
      await targets.kill(opened.edge.pid).catch(() => {});
      await removeLater(opened.edge.profile);
    }
    await probe.cursor(parkCursor.x, parkCursor.y).catch(() => {});
    await app.stop();
    targets.quit();
    probe.close();
    await sleep(500);
    await removeLater(scratch);
  }

  result.durationMs = Math.round(now() - t0);
  const lines = [
    '| # | Criterion | Budget | Measured | Result |',
    '| --- | --- | --- | --- | --- |',
    ...result.criteria.map(
      (c) =>
        `| ${c.id} | ${c.name} | ${c.budget} | ${c.measured} | ${c.pass === 'skip' ? 'skip' : c.pass ? 'pass' : 'fail'} |`,
    ),
  ];
  console.log(`\n${lines.join('\n')}\n`);
  if (options.out) {
    mkdirSync(path.dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
    log(`wrote ${options.out}`);
  }
  const failed = result.criteria.filter((c) => c.pass !== 'skip' && !c.pass);
  if (failed.length > 0) {
    log(`${failed.length} criterion/criteria failed: ${failed.map((c) => c.id).join(', ')}`);
    process.exitCode = 1;
  } else {
    log('all criteria pass');
  }
}

main().catch((error) => {
  console.error(`[drag-spike] ${error.message}`);
  process.exitCode = 1;
});
