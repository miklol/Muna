// `pnpm -w release:verify -- --dir <dir> [--version <v>] [--pubkey <base64|file>] [--no-authenticode]`
//
// Last gate before assets are attested and uploaded (docs/11-ci-cd.md#root-scripts-the-workflows-call):
//   - `signtool verify /pa` on every .exe and .msix in `--dir` (Authenticode chain + timestamp);
//   - the updater signature: every `latest.json` platform entry must reference an asset in the
//     directory whose minisign signature verifies against the updater public key
//     (`plugins.updater.pubkey` in tauri.conf.json, or `--pubkey`), and the `.sig` side file
//     must carry the same signature;
//   - `Muna.appinstaller` must point at an MSIX in the directory with the matching 4-part version.
// Every check is reported; the exit code is 1 if any failed. `--no-authenticode` is for local
// runs on unsigned builds only — the workflow never passes it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { isMain, parseArgs, repoRoot } from '../lib.mjs';
import { msixVersion, parseSemver } from '../version.mjs';
import { artifactNames, findSdkTool, requireOption, resolveDir } from './lib.mjs';
import { parsePublicKey, parseSignature, verifyMinisign } from './minisign.mjs';

const USAGE =
  'usage: release:verify -- --dir <dir> [--version <semver>] [--pubkey <base64|file>] [--no-authenticode]';

/** Reads the updater public key: `--pubkey` (file or literal) or tauri.conf.json. */
export function resolvePublicKey(option) {
  if (option) {
    const asFile = path.resolve(process.cwd(), option);
    return parsePublicKey(existsSync(asFile) ? readFileSync(asFile, 'utf8') : option);
  }
  const conf = JSON.parse(
    readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
  );
  const pubkey = conf.plugins?.updater?.pubkey;
  if (!pubkey || /REPLACE/.test(pubkey)) {
    throw new Error(
      'plugins.updater.pubkey in tauri.conf.json is still the placeholder; ' +
        'set it from `tauri signer generate` (docs/10-release-distribution.md) or pass --pubkey',
    );
  }
  return parsePublicKey(pubkey);
}

/** Pulls the attributes `release:verify` checks out of an `.appinstaller` document. */
export function parseAppInstaller(xml) {
  const attribute = (element, name) => {
    const block = new RegExp(`<${element}\\b([^>]*)>`, 's').exec(xml)?.[1] ?? '';
    return new RegExp(`\\b${name}="([^"]*)"`).exec(block)?.[1] ?? null;
  };
  return {
    version: attribute('AppInstaller', 'Version'),
    uri: attribute('AppInstaller', 'Uri'),
    packageName: attribute('MainPackage', 'Name'),
    packageVersion: attribute('MainPackage', 'Version'),
    packageUri: attribute('MainPackage', 'Uri'),
  };
}

function checkAuthenticode(dir, results) {
  const files = readdirSync(dir).filter((name) => /\.(exe|msix)$/i.test(name));
  if (files.length === 0) {
    results.push({
      check: 'authenticode',
      target: dir,
      ok: false,
      detail: 'no .exe or .msix found',
    });
    return;
  }
  const signtool = findSdkTool('signtool.exe');
  for (const name of files) {
    const result = spawnSync(signtool, ['verify', '/pa', '/v', path.join(dir, name)], {
      encoding: 'utf8',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    const signer = /Issued to:\s*(.+)/.exec(output)?.[1]?.trim();
    const timestamp = /The signature is timestamped:\s*(.+)/.exec(output)?.[1]?.trim();
    const ok = result.status === 0;
    results.push({
      check: 'authenticode',
      target: name,
      ok,
      detail: ok
        ? `signed by ${signer ?? 'unknown'}${timestamp ? `, timestamped ${timestamp}` : ', not timestamped'}`
        : (
            /SignTool Error: (.+)/.exec(output)?.[1] ?? `signtool exited with ${result.status}`
          ).trim(),
    });
  }
}

function checkUpdater(dir, publicKey, expectedVersion, results) {
  const latestPath = path.join(dir, 'latest.json');
  if (!existsSync(latestPath)) {
    results.push({ check: 'updater', target: 'latest.json', ok: false, detail: 'missing' });
    return;
  }
  let latest;
  try {
    latest = JSON.parse(readFileSync(latestPath, 'utf8'));
    parseSemver(latest.version);
  } catch (error) {
    results.push({ check: 'updater', target: 'latest.json', ok: false, detail: error.message });
    return;
  }
  if (expectedVersion && latest.version !== expectedVersion) {
    results.push({
      check: 'updater',
      target: 'latest.json',
      ok: false,
      detail: `version ${latest.version} ≠ ${expectedVersion}`,
    });
  }
  const platforms = Object.entries(latest.platforms ?? {});
  if (platforms.length === 0) {
    results.push({ check: 'updater', target: 'latest.json', ok: false, detail: 'no platforms' });
  }
  for (const [platform, entry] of platforms) {
    const asset = decodeURIComponent(new URL(entry.url).pathname.split('/').pop() ?? '');
    const assetPath = path.join(dir, asset);
    if (!existsSync(assetPath)) {
      results.push({
        check: 'updater',
        target: platform,
        ok: false,
        detail: `${asset} not in ${dir}`,
      });
      continue;
    }
    try {
      const signature = parseSignature(entry.signature);
      const verdict = verifyMinisign(readFileSync(assetPath), signature, publicKey);
      results.push({
        check: 'updater',
        target: `${platform} → ${asset}`,
        ...verdict,
        detail: verdict.reason,
      });
      const sideFile = `${assetPath}.sig`;
      if (existsSync(sideFile)) {
        const same = readFileSync(sideFile, 'utf8').trim() === String(entry.signature).trim();
        results.push({
          check: 'updater',
          target: `${asset}.sig`,
          ok: same,
          detail: same ? 'matches latest.json' : 'differs from latest.json',
        });
      }
    } catch (error) {
      results.push({ check: 'updater', target: platform, ok: false, detail: error.message });
    }
  }
}

function checkAppInstaller(dir, expectedVersion, results) {
  const feedPath = path.join(dir, 'Muna.appinstaller');
  if (!existsSync(feedPath)) {
    results.push({
      check: 'appinstaller',
      target: 'Muna.appinstaller',
      ok: false,
      detail: 'missing',
    });
    return;
  }
  const feed = parseAppInstaller(readFileSync(feedPath, 'utf8'));
  const asset = feed.packageUri ? decodeURIComponent(feed.packageUri.split('/').pop() ?? '') : '';
  const exists = asset !== '' && existsSync(path.join(dir, asset));
  results.push({
    check: 'appinstaller',
    target: 'MainPackage/@Uri',
    ok: exists,
    detail: exists ? `${asset} present` : `${asset || '(none)'} not in ${dir}`,
  });
  const sameVersion = feed.version !== null && feed.version === feed.packageVersion;
  results.push({
    check: 'appinstaller',
    target: 'Version',
    ok: sameVersion,
    detail: `feed ${feed.version}, package ${feed.packageVersion}`,
  });
  if (expectedVersion) {
    const wanted = msixVersion(expectedVersion);
    results.push({
      check: 'appinstaller',
      target: 'MainPackage/@Version',
      ok: feed.packageVersion === wanted,
      detail: `${feed.packageVersion} vs ${wanted}`,
    });
  }
}

function checkArtifacts(dir, version, results) {
  const names = artifactNames(version);
  for (const key of ['msix', 'externalLocationMsix', 'nsis']) {
    const present = existsSync(path.join(dir, names[key]));
    results.push({
      check: 'artifact',
      target: names[key],
      ok: present,
      detail: present ? 'present' : 'missing',
    });
  }
}

function main() {
  const { flags, options } = parseArgs();
  const dir = resolveDir(requireOption(options, 'dir', USAGE));
  const version = options.get('version') ?? null;
  const results = [];

  if (!existsSync(dir)) {
    console.error(`release:verify: ${dir} does not exist`);
    process.exit(1);
  }
  if (version) checkArtifacts(dir, version, results);
  if (flags.has('no-authenticode')) {
    console.warn('release:verify: warning: skipping Authenticode verification (--no-authenticode)');
  } else {
    checkAuthenticode(dir, results);
  }
  try {
    checkUpdater(dir, resolvePublicKey(options.get('pubkey')), version, results);
  } catch (error) {
    results.push({ check: 'updater', target: 'public key', ok: false, detail: error.message });
  }
  checkAppInstaller(dir, version, results);

  const width = Math.max(...results.map((r) => `${r.check} ${r.target}`.length));
  for (const result of results) {
    const label = `${result.check} ${result.target}`.padEnd(width);
    console.log(`${result.ok ? 'ok  ' : 'FAIL'}  ${label}  ${result.detail}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `release:verify: all ${results.length} checks passed`
      : `release:verify: ${failed} of ${results.length} checks failed`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

if (isMain(import.meta.url)) {
  main();
}
