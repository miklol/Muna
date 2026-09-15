// `pnpm -w release:updater -- --version <v> --tag <tag> --dir <dir>`
//
// Step 5 of the release pipeline (docs/10-release-distribution.md#pipeline): minisign the
// *already Authenticode-signed* NSIS installer with `tauri signer sign` and write `latest.json`
// for tauri-plugin-updater. The private key comes from the environment the workflow provides
// (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`); nothing here reads or
// logs it. Optional: `--notes <file>` (markdown/plain text shown in the update notice; default is
// a link to the release) and `--pub-date <ISO>` (default now).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMain, parseArgs, run } from '../lib.mjs';
import { parseSemver } from '../version.mjs';
import { artifactNames, readIdentity, releaseAssetUrl, requireOption, resolveDir } from './lib.mjs';

const USAGE =
  'usage: release:updater -- --version <semver> --tag <git tag> --dir <dir> [--notes <file>] [--pub-date <iso>]';

/** Contents of `latest.json` (https://v2.tauri.app/plugin/updater/#static-json-file). */
export function latestJson({ version, tag, repository, signature, notes, pubDate }) {
  parseSemver(version);
  const { nsis } = artifactNames(version);
  return {
    version,
    notes,
    pub_date: pubDate,
    platforms: {
      'windows-x86_64': {
        signature,
        url: releaseAssetUrl(repository, tag, nsis),
      },
    },
  };
}

function main() {
  const { options } = parseArgs();
  const version = requireOption(options, 'version', USAGE);
  const tag = requireOption(options, 'tag', USAGE);
  const dir = resolveDir(requireOption(options, 'dir', USAGE));
  const identity = readIdentity();
  const { nsis, latestJson: latestName } = artifactNames(version);

  const installer = path.join(dir, nsis);
  if (!existsSync(installer)) {
    console.error(`release:updater: ${installer} not found (run the NSIS bundle step first)`);
    process.exit(1);
  }
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    console.error(
      'release:updater: TAURI_SIGNING_PRIVATE_KEY (or TAURI_SIGNING_PRIVATE_KEY_PATH) is not set',
    );
    process.exit(1);
  }

  // The CLI reads the key and password from the environment and writes `<file>.sig` next to it.
  run('pnpm', ['--filter', '@muna/desktop', 'exec', 'tauri', 'signer', 'sign', installer]);

  const signatureFile = `${installer}.sig`;
  if (!existsSync(signatureFile)) {
    console.error(`release:updater: tauri signer sign did not write ${signatureFile}`);
    process.exit(1);
  }
  const signature = readFileSync(signatureFile, 'utf8').trim();

  const notes = options.has('notes')
    ? readFileSync(path.resolve(process.cwd(), options.get('notes')), 'utf8').trim()
    : `Muna ${version} — release notes: ${identity.repository}/releases/tag/${encodeURIComponent(tag)}`;
  const pubDate = options.get('pub-date') ?? new Date().toISOString();

  const manifest = latestJson({
    version,
    tag,
    repository: identity.repository,
    signature,
    notes,
    pubDate,
  });
  const target = path.join(dir, latestName);
  writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`release:updater: wrote ${target}`);
  console.log(`  windows-x86_64 → ${manifest.platforms['windows-x86_64'].url}`);
}

if (isMain(import.meta.url)) {
  main();
}
