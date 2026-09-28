// Performance harness (docs/09-testing-qa.md "Performance harness", docs/11-ci-cd.md
// "Performance gates"). Launches the built app with a scratch profile, measures cold start,
// idle CPU and memory of the whole process tree and — in full mode — the strip ↔ panel morph
// frame rate, compares with the PRD budgets and writes JSON plus the markdown the `app` job
// posts on the PR. Exit code 1 on any budget breach or when nothing could be measured.
//
//   node scripts/perf/index.mjs --smoke|--full [--out file.json] [--markdown file.md]
//        [--exe path\to\muna.exe] [--baseline earlier.json] [--morphs N] [--verbose]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isWindows, parseArgs, repoRoot } from '../lib.mjs';
import { App, Probe, defaultExe, driveMorphs, measureIdle } from './harness.mjs';
import { buildReport, failedReport, planFor, renderMarkdown, startupBreakdown } from './report.mjs';

const { flags, options } = parseArgs();
const mode = flags.has('full') ? 'full' : 'smoke';
const plan = planFor(mode);
if (options.has('morphs')) plan.morphs = Number(options.get('morphs'));
const verbose = flags.has('verbose');
const exe = options.has('exe')
  ? {
      path: path.resolve(repoRoot, options.get('exe')),
      profile: /release/i.test(options.get('exe')) ? 'release' : 'debug',
    }
  : defaultExe();
const baseline = options.has('baseline')
  ? JSON.parse(readFileSync(path.resolve(repoRoot, options.get('baseline')), 'utf8'))
  : null;

const log = (message) => console.log(`[perf] ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the WebView2 and watchdog processes of a stopped instance are gone, so a
 * relaunch on the same profile starts its own browser process instead of attaching to one
 * that is on its way out. The probe still lists a dead root's children by parent pid.
 */
async function waitForTreeExit(probe, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const alive = (await probe.tree(pid)).filter((p) => p.name !== 'unknown');
    if (alive.length === 0) return;
    await sleep(250);
  }
  log('processes of the first launch are still exiting; continuing');
}

function write(report) {
  const markdown = renderMarkdown(report, baseline);
  const out = options.get('out');
  const md = options.get('markdown');
  if (out) writeFileSync(path.resolve(repoRoot, out), `${JSON.stringify(report, null, 2)}\n`);
  if (md) writeFileSync(path.resolve(repoRoot, md), markdown);
  console.log(`\n${markdown}`);
  if (out) console.log(`wrote ${out}`);
  if (md) console.log(`wrote ${md}`);
}

async function main() {
  if (!isWindows) {
    write(
      failedReport({
        mode,
        plan,
        exe,
        host: null,
        error: 'The perf harness runs on Windows only.',
      }),
    );
    return 1;
  }
  if (!existsSync(exe.path)) {
    write(
      failedReport({
        mode,
        plan,
        exe,
        host: null,
        error: `Binary missing: \`${path.relative(repoRoot, exe.path)}\`. Run \`pnpm --filter @muna/desktop tauri build --debug --no-bundle\` first.`,
      }),
    );
    return 1;
  }

  log(`${mode} run against ${path.relative(repoRoot, exe.path)} (${exe.profile})`);
  const probe = new Probe();
  await probe.ready;
  const host = await probe.host();
  log(
    `host: ${host.os}, ${host.logicalProcessors} logical processors, ${host.memoryGb} GB, primary ${host.screenWidth}×${host.screenHeight}`,
  );

  let app = null;
  const notes = [];
  try {
    // The first launch of a binary the OS has not seen pays a one-time cost (file cache,
    // Defender's scan) that a user meets once per install or update; report it on its own
    // (docs/08 R20) and gate the next launch of the same binary and profile, which is every
    // other start.
    const first = new App(exe.path, {
      log: verbose ? (line) => console.log(`  ${line}`) : undefined,
    });
    const firstReady = await first.waitForReady('notch', 30_000);
    const firstLaunchMs = firstReady.atMs;
    log(`first launch of this binary: shell ready after ${firstLaunchMs} ms; restarting`);
    await first.stop({ keepProfile: true });
    await waitForTreeExit(probe, first.pid, 10_000);

    // Cold start: process creation → the shell's first painted strip (`shell ready`).
    app = new App(exe.path, {
      profile: first.profile,
      log: verbose ? (line) => console.log(`  ${line}`) : undefined,
    });
    const ready = await app.waitForReady('notch', 30_000);
    const startupMs = ready.atMs;
    log(`shell ready after ${startupMs} ms (${ready.sinceStartMs} ms after main)`);
    // Where the start went: the tree right after the first paint dates the WebView2 browser
    // process (everything before it is the app's own start-up) and the first renderer.
    const breakdown = startupBreakdown(await probe.tree(app.pid), app.pid);
    if (breakdown.webviewBrowserAtMs !== null) {
      log(
        `WebView2 browser process created ${breakdown.webviewBrowserAtMs} ms after the app, first renderer ${breakdown.firstRendererAtMs ?? '—'} ms`,
      );
    }

    log(`warming up ${plan.warmupSeconds} s…`);
    await sleep(plan.warmupSeconds * 1000);
    const idle = await measureIdle(app, probe, host, plan, plan.warmupSeconds, log);

    let morphs = [];
    if (plan.morphs > 0) {
      log(`driving ${plan.morphs} expand/collapse cycles…`);
      const driven = await driveMorphs(app, probe, host, plan.morphs, log);
      morphs = driven.morphs;
      notes.push(...driven.notes);
      if (morphs.length > 0) {
        // Memory after the morphs and collapse (docs/09 step 5).
        await sleep(2000);
        const settled = await probe.sample((await probe.tree(app.pid)).map((p) => p.pid));
        const privateWorkingSetMb = settled.reduce(
          (sum, p) => sum + (p.privateWorkingSetMb ?? 0),
          0,
        );
        idle.memorySamples.push({
          atSeconds: Math.round(idle.elapsedSeconds + 2),
          memoryTarget: app.memoryTarget,
          processes: settled.length,
          workingSetMb: settled.reduce((sum, p) => sum + (p.workingSetMb ?? 0), 0),
          privateWorkingSetMb,
          afterMorphs: true,
        });
        log(`memory after morphs: private ${privateWorkingSetMb.toFixed(1)} MB`);
      }
    } else {
      notes.push('Morph frame rate is measured by the nightly `perf:full` run.');
    }
    if (!idle.memorySamples.some((s) => s.memoryTarget === 'low')) {
      notes.push(
        'The shell never asked WebView2 for the low memory target: strip content, a focused settings window or cursor activity kept it at normal, so the memory value is the last sample.',
      );
    }
    if (exe.profile === 'debug') {
      notes.push(
        'Debug build (unoptimised Rust): startup and CPU are upper bounds for the release build.',
      );
    }

    const report = buildReport({
      mode,
      plan,
      exe: { path: path.relative(repoRoot, exe.path), profile: exe.profile },
      host,
      results: {
        firstLaunchMs,
        startupMs,
        sinceMainMs: ready.sinceStartMs,
        ...breakdown,
        ...idle,
        morphs,
      },
      notes,
    });
    write(report);
    if (!report.evaluation.pass) {
      console.error(`\nperf ${mode}: budget breached for ${report.evaluation.failed.join(', ')}`);
      return 1;
    }
    log(`${mode} ok`);
    return 0;
  } catch (error) {
    write(
      failedReport({
        mode,
        plan,
        exe: { path: path.relative(repoRoot, exe.path), profile: exe.profile },
        host,
        error: error.message,
      }),
    );
    console.error(`\nperf ${mode}: ${error.message}`);
    return 1;
  } finally {
    await app?.stop();
    probe.close();
  }
}

process.exitCode = await main();
