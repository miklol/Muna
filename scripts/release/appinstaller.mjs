// `pnpm -w release:appinstaller -- --version <v> --tag <tag> --dir <dir>`
//
// Step 6 of the release pipeline (docs/10-release-distribution.md#pipeline): writes
// `Muna.appinstaller`, the App Installer feed. Its own `Uri` is the stable
// `releases/latest/download/Muna.appinstaller` URL (so the file can advertise updates), while
// `MainPackage/@Uri` points at the versioned MSIX asset of this release. Runs in dry runs too, so
// it never needs secrets; the publisher comes from scripts/msix/identity.json exactly like the
// MSIX manifest (App Installer refuses a feed whose publisher differs from the package).
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { isMain, parseArgs } from '../lib.mjs';
import { msixVersion } from '../version.mjs';
import {
  artifactNames,
  escapeXml,
  isPlaceholderPublisher,
  readIdentity,
  releaseAssetUrl,
  requireOption,
  resolveDir,
} from './lib.mjs';

const USAGE =
  'usage: release:appinstaller -- --version <semver> --tag <git tag> --dir <dir> [--publisher <subject>]';

/** The `.appinstaller` document (schema 2018: OnLaunch prompt + background update task). */
export function appInstallerXml({ version, tag, identity, publisher }) {
  const { msix, appinstaller } = artifactNames(version);
  const packageVersion = msixVersion(version);
  const feedUri = `${identity.repository}/releases/latest/download/${appinstaller}`;
  const attributes = {
    Name: identity.name,
    Publisher: publisher,
    Version: packageVersion,
    ProcessorArchitecture: 'x64',
    Uri: releaseAssetUrl(identity.repository, tag, msix),
  };
  const mainPackage = Object.entries(attributes)
    .map(([key, value]) => `    ${key}="${escapeXml(value)}"`)
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<AppInstaller
  xmlns="http://schemas.microsoft.com/appx/appinstaller/2018"
  Version="${packageVersion}"
  Uri="${escapeXml(feedUri)}">
  <MainPackage
${mainPackage} />
  <UpdateSettings>
    <OnLaunch HoursBetweenUpdateChecks="6" ShowPrompt="true" UpdateBlocksActivation="false" />
    <AutomaticBackgroundTask />
  </UpdateSettings>
</AppInstaller>
`;
}

function main() {
  const { options } = parseArgs();
  const version = requireOption(options, 'version', USAGE);
  const tag = requireOption(options, 'tag', USAGE);
  const dir = resolveDir(requireOption(options, 'dir', USAGE));
  const identity = readIdentity();
  const publisher = options.get('publisher') ?? identity.publisher;
  const { msix, appinstaller } = artifactNames(version);

  if (isPlaceholderPublisher(publisher)) {
    const message = `publisher is still the placeholder "${publisher}" (scripts/msix/identity.json)`;
    if (process.env.GITHUB_ACTIONS === 'true' && process.env.DRY_RUN !== 'true') {
      console.error(`release:appinstaller: ${message}`);
      process.exit(1);
    }
    console.warn(`release:appinstaller: warning: ${message}`);
  }
  if (!existsSync(path.join(dir, msix))) {
    console.warn(`release:appinstaller: warning: ${msix} is not in ${dir} yet`);
  }

  const target = path.join(dir, appinstaller);
  writeFileSync(target, appInstallerXml({ version, tag, identity, publisher }));
  console.log(`release:appinstaller: wrote ${target} (package ${msixVersion(version)})`);
}

if (isMain(import.meta.url)) {
  main();
}
