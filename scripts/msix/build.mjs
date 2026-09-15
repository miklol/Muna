// msix:build — stages the release build, renders the manifests and packs the MSIX artefacts
// (docs/10-release-distribution.md#releaseyml-steps, step 3; ADR-0003).
//
//   pnpm -w msix:build -- --version <semver> --out <dir> [--exe <muna.exe>] [--publisher <subject>]
//                          [--test-sign] [--skip-external] [--keep-stage]
//
// Produces `Muna_<version>_x64.msix` (full package) and `Muna_<version>_x64-external.msix`
// (package with external location for the NSIS install) in --out. Both are UNSIGNED: release.yml
// signs everything in dist/release afterwards. `--test-sign` is for local install tests only:
// it signs with the ephemeral self-signed certificate from scripts/msix/test-cert.ps1 and uses
// identity.json `testPublisher` so the manifest Publisher equals the certificate Subject.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { ensureDir, formatBytes, parseArgs, repoRoot, run } from '../lib.mjs';
import {
  artifactNames,
  findSdkTool,
  isPlaceholderPublisher,
  manifestValues,
  readIdentity,
  renderTemplate,
  requireOption,
  requireWindows,
  resolveDir,
} from '../release/lib.mjs';

const USAGE =
  'usage: pnpm -w msix:build -- --version <semver> --out <dir> [--exe <path>] [--publisher <subject>] [--test-sign] [--skip-external] [--keep-stage]';

const ASSETS = [
  'StoreLogo.png',
  'Square150x150Logo.png',
  'Square44x44Logo.png',
  'Square71x71Logo.png',
];

const iconsDir = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'icons');
const fullTemplate = path.join(repoRoot, 'scripts', 'msix', 'AppxManifest.xml');
const externalTemplate = path.join(
  repoRoot,
  'scripts',
  'identity',
  'external-location.manifest.xml',
);
const defaultExe = path.join(
  repoRoot,
  'apps',
  'desktop',
  'src-tauri',
  'target',
  'release',
  'muna.exe',
);

function main() {
  requireWindows('msix:build');
  const { flags, options } = parseArgs();
  const version = requireOption(options, 'version', USAGE);
  const outDir = resolveDir(requireOption(options, 'out', USAGE));
  const exe = path.resolve(process.cwd(), options.get('exe') ?? defaultExe);
  const testSign = flags.has('test-sign');
  const identity = readIdentity();
  const publisher =
    options.get('publisher') ?? (testSign ? identity.testPublisher : identity.publisher);

  if (!existsSync(exe)) {
    console.error(
      `${exe} does not exist; run \`pnpm --filter @muna/desktop tauri build --no-bundle\` first`,
    );
    process.exit(1);
  }
  if (isPlaceholderPublisher(publisher)) {
    const realRelease = process.env.GITHUB_ACTIONS === 'true' && process.env.DRY_RUN !== 'true';
    const message =
      `identity.json publisher is still the placeholder "${publisher}"; set it to the signing ` +
      'certificate Subject before a real release (docs/spikes/m0-identity.md, maintainer checklist)';
    if (realRelease) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`warning: ${message}`);
  }

  const makeappx = findSdkTool('makeappx.exe');
  const names = artifactNames(version);
  const values = manifestValues(identity, version, publisher);
  ensureDir(outDir);
  const stageRoot = path.join(outDir, '.msix-stage');
  rmSync(stageRoot, { recursive: true, force: true });

  console.log(`msix:build ${version} → MSIX ${values.VERSION}, publisher ${publisher}`);
  const outputs = [];

  const fullStage = path.join(stageRoot, 'full');
  stageAssets(fullStage);
  copyFileSync(exe, path.join(fullStage, 'muna.exe'));
  writeManifest(fullStage, fullTemplate, values);
  outputs.push(pack(makeappx, fullStage, path.join(outDir, names.msix)));

  if (!flags.has('skip-external')) {
    const externalStage = path.join(stageRoot, 'external');
    stageAssets(externalStage);
    writeManifest(externalStage, externalTemplate, values);
    outputs.push(pack(makeappx, externalStage, path.join(outDir, names.externalLocationMsix)));
  }

  if (testSign) {
    signWithTestCertificate(outputs, publisher);
  }

  if (!flags.has('keep-stage')) rmSync(stageRoot, { recursive: true, force: true });
  for (const file of outputs) {
    console.log(
      `  ${path.basename(file)}  ${formatBytes(statSync(file).size)}${testSign ? '  (test-signed)' : '  (unsigned)'}`,
    );
  }
}

function stageAssets(stage) {
  const assets = path.join(stage, 'Assets');
  mkdirSync(assets, { recursive: true });
  for (const asset of ASSETS) {
    const source = path.join(iconsDir, asset);
    if (!existsSync(source)) {
      console.error(`missing icon ${source} (run \`pnpm --filter @muna/desktop tauri icon\`)`);
      process.exit(1);
    }
    copyFileSync(source, path.join(assets, asset));
  }
}

function writeManifest(stage, template, values) {
  const rendered = renderTemplate(readFileSync(template, 'utf8'), values);
  writeFileSync(path.join(stage, 'AppxManifest.xml'), rendered);
}

function pack(makeappx, stage, output) {
  rmSync(output, { force: true });
  // /nv skips semantic validation (docs/10); the schema is still validated. /o overwrites.
  run(makeappx, ['pack', '/d', stage, '/p', output, '/nv', '/o']);
  return output;
}

function signWithTestCertificate(files, publisher) {
  const script = path.join(repoRoot, 'scripts', 'msix', 'test-cert.ps1');
  // Windows PowerShell 5.1 fails to load its Certificate provider when it inherits a PSModulePath
  // set by PowerShell 7 (the parent shell of many dev setups); let it rebuild the default.
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^psmodulepath$/i.test(key)) delete env[key];
  }
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Subject', publisher],
    { encoding: 'utf8', env },
  );
  if (result.status !== 0) {
    console.error(`test-cert.ps1 failed:\n${result.stderr || result.stdout}`);
    process.exit(result.status ?? 1);
  }
  const lines = result.stdout.trim().split(/\r?\n/);
  const cert = JSON.parse(lines[lines.length - 1]);
  if (cert.subject !== publisher) {
    console.error(`certificate subject "${cert.subject}" != manifest publisher "${publisher}"`);
    process.exit(1);
  }
  console.log(
    `signing with test certificate ${cert.thumbprint} (${cert.subject}, expires ${cert.notAfter})`,
  );
  const signtool = findSdkTool('signtool.exe');
  for (const file of files) {
    run(signtool, ['sign', '/fd', 'SHA256', '/sha1', cert.thumbprint, '/s', 'My', file]);
  }
}

main();
