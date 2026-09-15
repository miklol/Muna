import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { msixVersion, parseSemver, readVersions, setVersions } from './version.mjs';

describe('parseSemver', () => {
  it('splits core, prerelease and build', () => {
    expect(parseSemver('1.2.3-beta.4+sha.abc')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: 'beta.4',
      build: 'sha.abc',
    });
  });

  it('rejects non-SemVer input', () => {
    expect(() => parseSemver('1.2')).toThrow(/not a SemVer/);
    expect(() => parseSemver('v1.2.3')).toThrow(/not a SemVer/);
    expect(() => parseSemver('01.2.3')).toThrow(/not a SemVer/);
  });
});

describe('msixVersion', () => {
  it('appends a zero revision and drops prerelease / dry-run suffixes', () => {
    expect(msixVersion('1.2.3')).toBe('1.2.3.0');
    expect(msixVersion('1.2.3-beta.1')).toBe('1.2.3.0');
    expect(msixVersion('0.0.0-dry.abc1234')).toBe('0.0.0.0');
  });

  it('refuses parts above the 16-bit MSIX limit', () => {
    expect(() => msixVersion('1.65536.0')).toThrow(/65535/);
  });
});

describe('readVersions / setVersions', () => {
  const roots = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function fakeRepo(version) {
    const root = mkdtempSync(path.join(tmpdir(), 'muna-version-'));
    roots.push(root);
    const write = (file, text) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    };
    write(
      'apps/desktop/package.json',
      `{\n  "name": "@muna/desktop",\n  "version": "${version}"\n}\n`,
    );
    write(
      'apps/desktop/src-tauri/tauri.conf.json',
      `{\n  "productName": "Muna",\n  "version": "${version}",\n  "plugins": { "updater": { "version": "not-me" } }\n}\n`,
    );
    write(
      'apps/desktop/src-tauri/Cargo.toml',
      `[workspace.package]\nversion = "${version}"\nedition = "2024"\n\n[dependencies]\nserde = { version = "1.0", features = ["derive"] }\n`,
    );
    write(
      'apps/desktop/src-tauri/Cargo.lock',
      `[[package]]\nname = "muna"\nversion = "${version}"\n\n[[package]]\nname = "muna-core"\nversion = "${version}"\n\n[[package]]\nname = "serde"\nversion = "1.0.200"\n`,
    );
    return root;
  }

  it('reads the same version from every file', () => {
    const root = fakeRepo('0.4.1');
    expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(['0.4.1']));
  });

  it('rewrites only the workspace versions', () => {
    const root = fakeRepo('0.4.1');
    setVersions('0.5.0', root);
    expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(['0.5.0']));
    const cargoToml = readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.toml'), 'utf8');
    expect(cargoToml).toContain('serde = { version = "1.0"');
    const lock = readFileSync(path.join(root, 'apps/desktop/src-tauri/Cargo.lock'), 'utf8');
    expect(lock).toContain('name = "serde"\nversion = "1.0.200"');
    const conf = JSON.parse(
      readFileSync(path.join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'),
    );
    expect(conf.plugins.updater.version).toBe('not-me');
  });
});
