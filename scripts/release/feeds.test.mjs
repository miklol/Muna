import { describe, expect, it } from 'vitest';

import { appInstallerXml } from './appinstaller.mjs';
import { readIdentity } from './lib.mjs';
import { latestJson } from './updater.mjs';
import { parseAppInstaller } from './verify.mjs';

const identity = readIdentity();

describe('appInstallerXml', () => {
  const xml = appInstallerXml({
    version: '1.2.3',
    tag: 'v1.2.3',
    identity,
    publisher: 'CN=Muna & Co, O="Quotes"',
  });

  it('points the feed at releases/latest and the package at the versioned asset', () => {
    const feed = parseAppInstaller(xml);
    expect(feed).toEqual({
      version: '1.2.3.0',
      uri: 'https://github.com/miklol/Muna/releases/latest/download/Muna.appinstaller',
      packageName: 'miklol.Muna',
      packageVersion: '1.2.3.0',
      packageUri: 'https://github.com/miklol/Muna/releases/download/v1.2.3/Muna_1.2.3_x64.msix',
    });
  });

  it('escapes the publisher and keeps the update settings', () => {
    expect(xml).toContain('Publisher="CN=Muna &amp; Co, O=&quot;Quotes&quot;"');
    expect(xml).toContain('ProcessorArchitecture="x64"');
    expect(xml).toContain('<OnLaunch HoursBetweenUpdateChecks="6" ShowPrompt="true"');
    expect(xml).toContain('xmlns="http://schemas.microsoft.com/appx/appinstaller/2018"');
  });

  it('uses the 4-part version for prereleases too', () => {
    const beta = appInstallerXml({
      version: '1.2.3-beta.1',
      tag: 'v1.2.3-beta.1',
      identity,
      publisher: 'CN=x',
    });
    expect(parseAppInstaller(beta).packageVersion).toBe('1.2.3.0');
    expect(parseAppInstaller(beta).packageUri).toContain('Muna_1.2.3-beta.1_x64.msix');
  });
});

describe('latestJson', () => {
  it('matches the tauri-plugin-updater static JSON format', () => {
    const manifest = latestJson({
      version: '1.2.3',
      tag: 'v1.2.3',
      repository: identity.repository,
      signature: 'c2ln',
      notes: 'notes',
      pubDate: '2026-09-15T00:00:00.000Z',
    });
    expect(manifest).toEqual({
      version: '1.2.3',
      notes: 'notes',
      pub_date: '2026-09-15T00:00:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'c2ln',
          url: 'https://github.com/miklol/Muna/releases/download/v1.2.3/Muna_1.2.3_x64-setup.exe',
        },
      },
    });
  });

  it('rejects a non-SemVer version', () => {
    expect(() =>
      latestJson({
        version: 'v1',
        tag: 't',
        repository: 'r',
        signature: 's',
        notes: 'n',
        pubDate: 'p',
      }),
    ).toThrow(/SemVer/);
  });
});
