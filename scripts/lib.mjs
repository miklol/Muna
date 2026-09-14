// Shared helpers for the root scripts. Plain Node, no dependencies.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const isWindows = process.platform === 'win32';

/** Drops a leading `--` that pnpm may or may not forward, then parses `--key value` pairs. */
export function parseArgs(argv = process.argv.slice(2)) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const flags = new Set();
  const options = new Map();
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        options.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.set(arg.slice(2), args[i + 1]);
        i += 1;
      } else {
        flags.add(arg.slice(2));
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, options, positional };
}

/** Windows: `pnpm` is a .cmd shim, which Node refuses to spawn without a shell. */
function resolveCommand(command, args) {
  if (!isWindows || command !== 'pnpm') return { command, args, options: {} };
  const execPath = process.env.npm_execpath;
  if (execPath && /\.c?js$/.test(execPath)) {
    return { command: process.execPath, args: [execPath, ...args], options: {} };
  }
  const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  return {
    command: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${['pnpm', ...args].map(quote).join(' ')}"`],
    options: { windowsVerbatimArguments: true },
  };
}

/** Runs a command, inheriting stdio; exits the process on failure unless `allowFailure`. */
export function run(command, args, { cwd = repoRoot, env = {}, allowFailure = false } = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`\n$ ${printable}`);
  const resolved = resolveCommand(command, args);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    ...resolved.options,
  });
  if (result.error) {
    console.error(`failed to start ${printable}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0 && !allowFailure) {
    console.error(`\n${printable} exited with code ${result.status ?? 'unknown'}`);
    process.exit(result.status ?? 1);
  }
  return result.status ?? 0;
}

/**
 * Like `run`, but keeps the event loop free while the child runs, so callers can serve HTTP
 * (or otherwise stay responsive) in the same process. Resolves with the exit code.
 */
export function runAsync(command, args, { cwd = repoRoot, env = {}, allowFailure = false } = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`\n$ ${printable}`);
  const resolved = resolveCommand(command, args);
  return new Promise((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
      ...resolved.options,
    });
    child.once('error', (error) => {
      console.error(`failed to start ${printable}: ${error.message}`);
      process.exit(1);
    });
    child.once('exit', (status) => {
      if (status !== 0 && !allowFailure) {
        console.error(`\n${printable} exited with code ${status ?? 'unknown'}`);
        process.exit(status ?? 1);
      }
      resolve(status ?? 0);
    });
  });
}

export function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function fileSize(file) {
  return existsSync(file) ? statSync(file).size : null;
}

export function formatBytes(bytes) {
  if (bytes === null) return 'missing';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * tauri-build embeds `frontendDist`, so cargo needs `apps/desktop/dist` to exist even for
 * checks that never look at the web bundle. Writes a placeholder when it is missing (the web
 * build itself needs the generated bindings, so this cannot run the web build).
 */
export function ensureFrontendDist() {
  const dist = path.join(repoRoot, 'apps', 'desktop', 'dist');
  const index = path.join(dist, 'index.html');
  if (!existsSync(index)) {
    console.log('apps/desktop/dist missing; writing a placeholder so tauri codegen can run');
    ensureDir(dist);
    writeFileSync(index, '<!doctype html><title>Muna placeholder</title>\n');
  }
  return dist;
}
