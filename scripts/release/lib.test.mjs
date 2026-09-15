import { describe, expect, it } from 'vitest';

import {
  artifactNames,
  escapeXml,
  isPlaceholderPublisher,
  manifestValues,
  readIdentity,
  releaseAssetUrl,
  renderTemplate,
} from './lib.mjs';

describe('artifactNames', () => {
  it('follows docs/10-release-distribution.md#artifacts', () => {
    expect(artifactNames('1.2.3')).toEqual({
      msix: 'Muna_1.2.3_x64.msix',
      externalLocationMsix: 'Muna_1.2.3_x64-external.msix',
      nsis: 'Muna_1.2.3_x64-setup.exe',
      appinstaller: 'Muna.appinstaller',
      latestJson: 'latest.json',
    });
  });
});

describe('releaseAssetUrl', () => {
  it('encodes the tag and asset', () => {
    expect(releaseAssetUrl('https://github.com/miklol/Muna', 'v1.2.3', 'Muna_1.2.3_x64.msix')).toBe(
      'https://github.com/miklol/Muna/releases/download/v1.2.3/Muna_1.2.3_x64.msix',
    );
    expect(releaseAssetUrl('https://github.com/miklol/Muna', 'dry run', 'a b')).toBe(
      'https://github.com/miklol/Muna/releases/download/dry%20run/a%20b',
    );
  });
});

describe('renderTemplate', () => {
  it('replaces placeholders with XML-escaped values', () => {
    expect(renderTemplate('<a x="{{X}}">{{Y}}</a>', { X: 'a & b', Y: '<' })).toBe(
      '<a x="a &amp; b">&lt;</a>',
    );
  });

  it('throws on a placeholder without a value', () => {
    expect(() => renderTemplate('{{MISSING}}', {})).toThrow(/\{\{MISSING\}\}/);
  });

  it('leaves lower-case braces alone', () => {
    expect(renderTemplate('{{not_a_placeholder}}', {})).toBe('{{not_a_placeholder}}');
  });
});

describe('escapeXml', () => {
  it('escapes the five XML entities', () => {
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
  });
});

describe('identity.json', () => {
  const identity = readIdentity();

  it('has every value the manifests need', () => {
    const values = manifestValues(identity, '1.2.3-beta.1', identity.publisher);
    for (const [key, value] of Object.entries(values)) {
      expect(value, key).toBeTruthy();
    }
    expect(values.VERSION).toBe('1.2.3.0');
    expect(values.NAME).toBe('miklol.Muna');
  });

  it('uses X.500 subjects for both publishers', () => {
    expect(identity.publisher).toMatch(/^CN=/);
    expect(identity.testPublisher).toMatch(/^CN=/);
    expect(isPlaceholderPublisher(identity.testPublisher)).toBe(false);
    expect(isPlaceholderPublisher('CN=REPLACE-WITH-SIGNING-CERTIFICATE-SUBJECT')).toBe(true);
  });
});
