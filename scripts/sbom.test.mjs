import { describe, expect, it } from 'vitest';

import { cargoGraph, cycloneDx, licenseEntry, licenseIndex, npmGraph, purl } from './sbom.mjs';

describe('purl', () => {
  it('encodes scoped npm names and cargo crates', () => {
    expect(purl('npm', '@muna/ui', '0.1.0')).toBe('pkg:npm/%40muna/ui@0.1.0');
    expect(purl('npm', 'react', '19.3.0')).toBe('pkg:npm/react@19.3.0');
    expect(purl('cargo', 'windows', '0.62.2')).toBe('pkg:cargo/windows@0.62.2');
  });
});

describe('licenseEntry', () => {
  it('distinguishes SPDX ids from expressions', () => {
    expect(licenseEntry('MIT')).toEqual([{ license: { id: 'MIT' } }]);
    expect(licenseEntry('MIT OR Apache-2.0')).toEqual([{ expression: 'MIT OR Apache-2.0' }]);
    expect(licenseEntry('MIT/Apache-2.0')).toEqual([{ expression: 'MIT OR Apache-2.0' }]);
    expect(licenseEntry('(MIT AND CC-BY-3.0)')).toEqual([{ expression: '(MIT AND CC-BY-3.0)' }]);
    expect(licenseEntry(null)).toBeUndefined();
    expect(licenseEntry('  ')).toBeUndefined();
  });
});

describe('npmGraph', () => {
  const listJson = [
    {
      name: '@muna/desktop',
      version: '0.0.0',
      dependencies: {
        react: { version: '19.3.0', dependencies: {} },
        '@muna/ui': {
          version: 'link:../../packages/ui',
          path: '/repo/packages/ui',
          dependencies: {
            react: { version: '19.3.0' },
            'react-aria-components': {
              version: '1.14.0',
              dependencies: { react: { version: '19.3.0' } },
            },
          },
        },
      },
    },
  ];
  const licenses = licenseIndex({
    MIT: [{ name: 'react', versions: ['19.3.0'] }],
    'Apache-2.0': [{ name: 'react-aria-components', versions: ['1.14.0'] }],
  });
  const graph = npmGraph(listJson, licenses, {
    readPackageJson: () => ({ version: '0.0.0', license: 'MIT' }),
  });

  it('dedupes components and resolves workspace links to their own version', () => {
    expect(graph.components.map((c) => c['bom-ref'])).toEqual([
      'pkg:npm/%40muna/ui@0.0.0',
      'pkg:npm/react-aria-components@1.14.0',
      'pkg:npm/react@19.3.0',
    ]);
    expect(graph.components[0].licenses).toEqual([{ license: { id: 'MIT' } }]);
    expect(graph.components[2].licenses).toEqual([{ license: { id: 'MIT' } }]);
  });

  it('records the root and every edge', () => {
    expect(graph.root).toMatchObject({
      type: 'application',
      name: '@muna/desktop',
      version: '0.0.0',
    });
    expect(graph.dependencies[0]).toEqual({
      ref: 'pkg:npm/%40muna/desktop@0.0.0',
      dependsOn: ['pkg:npm/%40muna/ui@0.0.0', 'pkg:npm/react@19.3.0'],
    });
    expect(graph.dependencies.find((d) => d.ref === 'pkg:npm/%40muna/ui@0.0.0').dependsOn).toEqual([
      'pkg:npm/react-aria-components@1.14.0',
      'pkg:npm/react@19.3.0',
    ]);
  });
});

describe('cargoGraph', () => {
  const id = (name, version, source = 'registry+https://github.com/rust-lang/crates.io-index') =>
    `${source}#${name}@${version}`;
  const muna = id('muna', '0.0.0', 'path+file:///repo/apps/desktop/src-tauri');
  const platform = id(
    'muna-platform',
    '0.0.0',
    'path+file:///repo/apps/desktop/src-tauri/crates/muna-platform',
  );
  const metadata = {
    packages: [
      { id: muna, name: 'muna', version: '0.0.0', license: 'MIT', repository: null },
      { id: platform, name: 'muna-platform', version: '0.0.0', license: null, repository: null },
      {
        id: id('windows', '0.62.2'),
        name: 'windows',
        version: '0.62.2',
        license: 'MIT OR Apache-2.0',
        repository: 'https://github.com/microsoft/windows-rs',
      },
      {
        id: id('tauri-build', '2.0.0'),
        name: 'tauri-build',
        version: '2.0.0',
        license: 'MIT',
        repository: null,
      },
      {
        id: id('insta', '1.0.0'),
        name: 'insta',
        version: '1.0.0',
        license: 'Apache-2.0',
        repository: null,
      },
      {
        id: id('windows-core', '0.62.2'),
        name: 'windows-core',
        version: '0.62.2',
        license: 'MIT OR Apache-2.0',
        repository: null,
      },
    ],
    workspace_members: [muna, platform],
    resolve: {
      nodes: [
        {
          id: muna,
          deps: [
            { name: 'muna_platform', pkg: platform, dep_kinds: [{ kind: null, target: null }] },
            {
              name: 'tauri_build',
              pkg: id('tauri-build', '2.0.0'),
              dep_kinds: [{ kind: 'build', target: null }],
            },
            {
              name: 'insta',
              pkg: id('insta', '1.0.0'),
              dep_kinds: [{ kind: 'dev', target: null }],
            },
          ],
        },
        {
          id: platform,
          deps: [
            {
              name: 'windows',
              pkg: id('windows', '0.62.2'),
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
        },
        {
          id: id('windows', '0.62.2'),
          deps: [
            {
              name: 'windows_core',
              pkg: id('windows-core', '0.62.2'),
              dep_kinds: [{ kind: null, target: null }],
            },
          ],
        },
        { id: id('windows-core', '0.62.2'), deps: [] },
        { id: id('tauri-build', '2.0.0'), deps: [] },
        { id: id('insta', '1.0.0'), deps: [] },
      ],
    },
  };
  const graph = cargoGraph(metadata, 'muna');

  it('includes only the normal-dependency closure', () => {
    expect(graph.components.map((c) => c.name)).toEqual([
      'muna-platform',
      'windows-core',
      'windows',
    ]);
    expect(graph.root).toMatchObject({
      name: 'muna',
      purl: 'pkg:cargo/muna@0.0.0',
      licenses: [{ license: { id: 'MIT' } }],
    });
  });

  it('carries licences and repositories, root edge first', () => {
    const windows = graph.components.find((c) => c.name === 'windows');
    expect(windows.licenses).toEqual([{ expression: 'MIT OR Apache-2.0' }]);
    expect(windows.externalReferences).toEqual([
      { type: 'vcs', url: 'https://github.com/microsoft/windows-rs' },
    ]);
    expect(graph.dependencies[0]).toEqual({
      ref: 'pkg:cargo/muna@0.0.0',
      dependsOn: ['pkg:cargo/muna-platform@0.0.0'],
    });
    expect(graph.dependencies.find((d) => d.ref === 'pkg:cargo/windows@0.62.2').dependsOn).toEqual([
      'pkg:cargo/windows-core@0.62.2',
    ]);
  });

  it('fails clearly when the root crate is missing', () => {
    expect(() => cargoGraph(metadata, 'nope')).toThrow(/"nope" not found/);
  });
});

describe('cycloneDx', () => {
  it('wraps the graph in a 1.5 document', () => {
    const doc = cycloneDx({
      root: { type: 'application', 'bom-ref': 'r', name: 'r', version: '1' },
      components: [],
      dependencies: [],
      toolVersion: '0.0.0',
      timestamp: '2026-09-15T00:00:00.000Z',
    });
    expect(doc).toMatchObject({ bomFormat: 'CycloneDX', specVersion: '1.5', version: 1 });
    expect(doc.serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(doc.metadata.tools[0]).toEqual({
      vendor: 'miklol',
      name: 'muna-sbom',
      version: '0.0.0',
    });
  });
});
