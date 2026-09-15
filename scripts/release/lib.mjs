// Shared helpers for the release scripts (msix:build, release:*, sbom). Plain Node.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { isWindows, repoRoot } from '../lib.mjs';
import { msixVersion } from '../version.mjs';

export const identityPath = path.join(repoRoot, 'scripts', 'msix', 'identity.json');

/** Package identity constants (scripts/msix/identity.json). */
export function readIdentity() {
  return JSON.parse(readFileSync(identityPath, 'utf8'));
}

export function isPlaceholderPublisher(publisher) {
  return /REPLACE/i.test(publisher);
}

/** Release asset file names (docs/10-release-distribution.md#artifacts). */
export function artifactNames(version) {
  return {
    msix: `Muna_${version}_x64.msix`,
    externalLocationMsix: `Muna_${version}_x64-external.msix`,
    nsis: `Muna_${version}_x64-setup.exe`,
    appinstaller: 'Muna.appinstaller',
    latestJson: 'latest.json',
  };
}

/** `https://github.com/miklol/Muna/releases/download/<tag>/<asset>`. */
export function releaseAssetUrl(repository, tag, asset) {
  return `${repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

/**
 * Renders `{{KEY}}` placeholders. Values are XML-escaped; throws on a placeholder without a
 * value so a template edit cannot silently ship `{{VERSION}}`.
 */
export function renderTemplate(template, values) {
  return template.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key) => {
    if (!(key in values)) throw new Error(`template placeholder {{${key}}} has no value`);
    return escapeXml(String(values[key]));
  });
}

export function escapeXml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Values every manifest template shares. */
export function manifestValues(identity, version, publisher) {
  return {
    NAME: identity.name,
    PUBLISHER: publisher,
    PUBLISHER_DISPLAY_NAME: identity.publisherDisplayName,
    DISPLAY_NAME: identity.displayName,
    DESCRIPTION: identity.description,
    APP_ID: identity.applicationId,
    STARTUP_TASK_ID: identity.startupTaskId,
    MIN_VERSION: identity.minVersion,
    MAX_VERSION_TESTED: identity.maxVersionTested,
    VERSION: msixVersion(version),
  };
}

/**
 * Locates a Windows SDK tool (`makeappx.exe`, `signtool.exe`): `MUNA_WINDOWS_SDK_BIN` first,
 * then PATH, then the newest `Windows Kits\10\bin\<version>\x64`. GitHub's windows-latest
 * runners ship the SDK, so the release workflow needs no extra setup step.
 */
export function findSdkTool(name) {
  const candidates = [];
  if (process.env.MUNA_WINDOWS_SDK_BIN) {
    candidates.push(path.join(process.env.MUNA_WINDOWS_SDK_BIN, name));
  }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, name));
  }
  const kits = path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Windows Kits',
    '10',
    'bin',
  );
  if (existsSync(kits)) {
    const versions = readdirSync(kits, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^10\.\d+\.\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersionsDesc);
    for (const version of versions) {
      candidates.push(path.join(kits, version, 'x64', name));
    }
  }
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `${name} not found. Install the Windows 10/11 SDK (Windows Kits\\10\\bin\\<version>\\x64) ` +
        'or set MUNA_WINDOWS_SDK_BIN to the folder that contains it.',
    );
  }
  return found;
}

function compareVersionsDesc(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i += 1) {
    if (pa[i] !== pb[i]) return pb[i] - pa[i];
  }
  return 0;
}

export function requireWindows(what) {
  if (!isWindows) {
    console.error(`${what} needs Windows (MakeAppx / signtool are Windows SDK tools).`);
    process.exit(1);
  }
}

/** Absolute path for a CLI `--out` / `--dir` value (relative to the caller's cwd). */
export function resolveDir(value, fallback) {
  return path.resolve(process.cwd(), value ?? fallback);
}

export function requireOption(options, name, usage) {
  const value = options.get(name);
  if (!value) {
    console.error(`missing --${name}\n${usage}`);
    process.exit(2);
  }
  return value;
}
