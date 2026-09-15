// `pnpm -w sbom -- --out <dir> [--version <v>]`
//
// CycloneDX 1.5 SBOMs for what ships in a release (docs/11-ci-cd.md#supply-chain):
//   Muna_<ver>_sbom-npm.cdx.json    production npm dependencies reachable from @muna/desktop
//   Muna_<ver>_sbom-cargo.cdx.json  normal (non dev/build) crates reachable from `muna` on
//                                   x86_64-pc-windows-msvc
// Sources are the package managers' own resolved graphs (`pnpm list --json`, `pnpm licenses
// list --json`, `cargo metadata`), so no extra tooling is installed on the release runner.
// `--version` defaults to `$VERSION` (set by release.yml, e.g. `1.2.3` or `0.0.0-dry.abc1234`)
// and then to apps/desktop/package.json.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { capture, ensureDir, isMain, parseArgs, repoRoot } from './lib.mjs';
import { requireOption } from './release/lib.mjs';
import { appVersion } from './version.mjs';

const USAGE = 'usage: sbom -- --out <dir> [--version <semver>]';
const CARGO_MANIFEST = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'Cargo.toml');

/** `pkg:npm/%40scope/name@1.2.3` / `pkg:cargo/name@1.2.3` (https://github.com/package-url/purl-spec). */
export function purl(type, name, version) {
  const encoded = name
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `pkg:${type}/${encoded}@${encodeURIComponent(version)}`;
}

/** CycloneDX `licenses[]`: an SPDX id, or an expression when the string has operators. */
export function licenseEntry(text) {
  if (!text) return undefined;
  const trimmed = String(text).trim();
  if (trimmed === '') return undefined;
  const isExpression = /\s(?:OR|AND|WITH)\s|\(|\//.test(trimmed);
  return [
    isExpression ? { expression: trimmed.replaceAll('/', ' OR ') } : { license: { id: trimmed } },
  ];
}

/** Wraps components + dependency edges in a CycloneDX 1.5 document. */
export function cycloneDx({ root, components, dependencies, toolVersion, timestamp }) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp,
      tools: [{ vendor: 'miklol', name: 'muna-sbom', version: toolVersion }],
      component: root,
    },
    components,
    dependencies,
  };
}

/**
 * Walks the `pnpm list --json --depth Infinity` tree. Workspace links (`link:../..`) become
 * components with the version from their own package.json.
 */
export function npmGraph(listJson, licenses, { readPackageJson }) {
  const rootEntry = listJson[0];
  const components = new Map();
  const edges = new Map();

  const visit = (name, entry) => {
    let version = entry.version;
    let license = licenses.get(`${name}@${version}`) ?? licenses.get(name);
    if (version.startsWith('link:')) {
      const manifest = readPackageJson(entry.path);
      version = manifest.version;
      license = manifest.license;
    }
    const ref = purl('npm', name, version);
    if (!components.has(ref)) {
      components.set(ref, {
        type: 'library',
        'bom-ref': ref,
        name,
        version,
        purl: ref,
        licenses: licenseEntry(license),
      });
      edges.set(ref, new Set());
      for (const [childName, child] of Object.entries(entry.dependencies ?? {})) {
        edges.get(ref).add(visit(childName, child));
      }
    }
    return ref;
  };

  const rootRef = purl('npm', rootEntry.name, rootEntry.version);
  const rootDeps = new Set();
  for (const [name, entry] of Object.entries(rootEntry.dependencies ?? {})) {
    rootDeps.add(visit(name, entry));
  }
  return {
    root: {
      type: 'application',
      'bom-ref': rootRef,
      name: rootEntry.name,
      version: rootEntry.version,
      purl: rootRef,
    },
    components: [...components.values()].sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
    dependencies: [
      { ref: rootRef, dependsOn: [...rootDeps].sort() },
      ...[...edges.entries()]
        .map(([ref, deps]) => ({ ref, dependsOn: [...deps].sort() }))
        .sort((a, b) => a.ref.localeCompare(b.ref)),
    ],
  };
}

/** `pnpm licenses list --json` → `name@version` and `name` → license string. */
export function licenseIndex(licensesJson) {
  const index = new Map();
  for (const [license, packages] of Object.entries(licensesJson)) {
    for (const pkg of packages) {
      index.set(pkg.name, license);
      for (const version of pkg.versions ?? []) index.set(`${pkg.name}@${version}`, license);
    }
  }
  return index;
}

/**
 * Normal-dependency closure of `rootName` from `cargo metadata` (already platform-filtered).
 * Dev and build dependencies are not shipped and are left out.
 */
export function cargoGraph(metadata, rootName) {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const rootPkg = metadata.packages.find(
    (pkg) => pkg.name === rootName && metadata.workspace_members.includes(pkg.id),
  );
  if (!rootPkg) throw new Error(`cargo metadata: workspace package "${rootName}" not found`);

  const components = new Map();
  const edges = new Map();
  const refOf = (pkg) => purl('cargo', pkg.name, pkg.version);

  const visit = (id) => {
    const pkg = packages.get(id);
    const ref = refOf(pkg);
    if (components.has(ref)) return ref;
    const isRoot = id === rootPkg.id;
    if (!isRoot) {
      components.set(ref, {
        type: 'library',
        'bom-ref': ref,
        name: pkg.name,
        version: pkg.version,
        purl: ref,
        licenses: licenseEntry(pkg.license),
        externalReferences: pkg.repository ? [{ type: 'vcs', url: pkg.repository }] : undefined,
      });
    } else {
      components.set(ref, null);
    }
    const deps = new Set();
    for (const dep of nodes.get(id)?.deps ?? []) {
      if (dep.dep_kinds.some((kind) => kind.kind === null)) deps.add(visit(dep.pkg));
    }
    edges.set(ref, deps);
    return ref;
  };
  const rootRef = visit(rootPkg.id);

  return {
    root: {
      type: 'application',
      'bom-ref': rootRef,
      name: rootPkg.name,
      version: rootPkg.version,
      purl: rootRef,
      licenses: licenseEntry(rootPkg.license),
    },
    components: [...components.values()]
      .filter((component) => component !== null)
      .sort((a, b) => a['bom-ref'].localeCompare(b['bom-ref'])),
    dependencies: [...edges.entries()]
      .map(([ref, deps]) => ({ ref, dependsOn: [...deps].sort() }))
      .sort((a, b) =>
        a.ref === rootRef ? -1 : b.ref === rootRef ? 1 : a.ref.localeCompare(b.ref),
      ),
  };
}

function main() {
  const { options } = parseArgs();
  const out = path.resolve(process.cwd(), requireOption(options, 'out', USAGE));
  const version = options.get('version') ?? process.env.VERSION ?? appVersion();
  const timestamp = new Date().toISOString();
  ensureDir(out);

  const listJson = JSON.parse(
    capture('pnpm', [
      'list',
      '--filter',
      '@muna/desktop',
      '--prod',
      '--depth',
      'Infinity',
      '--json',
    ]),
  );
  const licenses = licenseIndex(
    JSON.parse(capture('pnpm', ['-w', 'licenses', 'list', '--json', '--prod'])),
  );
  const npm = npmGraph(listJson, licenses, {
    readPackageJson: (dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')),
  });
  const npmTarget = path.join(out, `Muna_${version}_sbom-npm.cdx.json`);
  writeFileSync(
    npmTarget,
    `${JSON.stringify(cycloneDx({ ...npm, toolVersion: appVersion(), timestamp }), null, 2)}\n`,
  );
  console.log(`sbom: ${npmTarget} (${npm.components.length} components)`);

  const metadata = JSON.parse(
    capture('cargo', [
      'metadata',
      '--format-version',
      '1',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
      '--manifest-path',
      CARGO_MANIFEST,
    ]),
  );
  const cargo = cargoGraph(metadata, 'muna');
  const cargoTarget = path.join(out, `Muna_${version}_sbom-cargo.cdx.json`);
  writeFileSync(
    cargoTarget,
    `${JSON.stringify(cycloneDx({ ...cargo, toolVersion: appVersion(), timestamp }), null, 2)}\n`,
  );
  console.log(`sbom: ${cargoTarget} (${cargo.components.length} components)`);
}

if (isMain(import.meta.url)) {
  main();
}
