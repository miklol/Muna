// Version plumbing (docs/10-release-distribution.md#versioning). `apps/desktop/package.json` is
// the single source of truth; release-please bumps Cargo.toml and tauri.conf.json with it, and
// this module derives the 4-part MSIX version at build time. Also usable as a CLI:
//
//   node scripts/version.mjs                 print the versions every file declares
//   node scripts/version.mjs --check         exit 1 unless they all agree
//   node scripts/version.mjs --msix 1.2.3    print the MSIX version (1.2.3.0)
//   node scripts/version.mjs --set 1.2.3     write 1.2.3 into every file (manual bumps)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMain, parseArgs, repoRoot } from './lib.mjs';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Splits `1.2.3-beta.4+sha` into numbers and the optional prerelease / build strings. */
export function parseSemver(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`"${version}" is not a SemVer version`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
  };
}

/**
 * MSIX `Identity/@Version` is `Major.Minor.Build.Revision`, each 0–65535, numeric only. Muna
 * uses `x.y.z.0`: prerelease and dry-run suffixes (`1.2.3-beta.1`, `0.0.0-dry.abc1234`) are
 * dropped because the App Installer feed only ever points at stable releases
 * (`releases/latest` skips prereleases). Revision stays 0 for Store compatibility.
 */
export function msixVersion(version) {
  const { major, minor, patch } = parseSemver(version);
  for (const part of [major, minor, patch]) {
    if (part > 65535) throw new Error(`"${version}": MSIX version parts must be ≤ 65535`);
  }
  return `${major}.${minor}.${patch}.0`;
}

const files = {
  'apps/desktop/package.json': {
    read: (text) => JSON.parse(text).version,
    write: (text, version) => text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`),
  },
  'apps/desktop/src-tauri/tauri.conf.json': {
    read: (text) => JSON.parse(text).version,
    write: (text, version) => text.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`),
  },
  'apps/desktop/src-tauri/Cargo.toml': {
    // The first `version = "…"` is `[workspace.package]`, inherited by every crate.
    read: (text) => /^version\s*=\s*"([^"]*)"/m.exec(text)?.[1],
    write: (text, version) => text.replace(/^(version\s*=\s*")[^"]*(")/m, `$1${version}$2`),
  },
  'apps/desktop/src-tauri/Cargo.lock': {
    read: (text) => /name = "muna"\r?\nversion = "([^"]*)"/.exec(text)?.[1],
    // Workspace crates only; third-party entries keep their versions.
    write: (text, version) =>
      text.replace(
        /(name = "muna(?:-core|-platform|-probe)?"\r?\nversion = ")[^"]*(")/g,
        `$1${version}$2`,
      ),
  },
};

/** `{ file: version }` for every file that carries the version. */
export function readVersions(root = repoRoot) {
  return Object.fromEntries(
    Object.entries(files).map(([file, { read }]) => [
      file,
      read(readFileSync(path.join(root, file), 'utf8')) ?? null,
    ]),
  );
}

/** The app version from `apps/desktop/package.json`. */
export function appVersion(root = repoRoot) {
  return readVersions(root)['apps/desktop/package.json'];
}

export function setVersions(version, root = repoRoot) {
  parseSemver(version);
  for (const [file, { write }] of Object.entries(files)) {
    const target = path.join(root, file);
    writeFileSync(target, write(readFileSync(target, 'utf8'), version));
  }
}

function main() {
  const { flags, options } = parseArgs();
  if (options.has('msix')) {
    console.log(msixVersion(options.get('msix')));
    return;
  }
  if (options.has('set')) {
    setVersions(options.get('set'));
    console.log(`version set to ${options.get('set')} in ${Object.keys(files).length} files`);
    return;
  }
  const versions = readVersions();
  for (const [file, version] of Object.entries(versions)) {
    console.log(`${file}: ${version ?? 'missing'}`);
  }
  const distinct = new Set(Object.values(versions));
  if (flags.has('check') && distinct.size !== 1) {
    console.error('version:check failed: the files above disagree (run --set <version>)');
    process.exit(1);
  }
  console.log(`msix: ${msixVersion(appVersion())}`);
}

if (isMain(import.meta.url)) {
  main();
}
