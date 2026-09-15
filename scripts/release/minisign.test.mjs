import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { parsePublicKey, parseSignature, verifyMinisign } from './minisign.mjs';

/**
 * Builds a minisign key pair and signature the way rsign2 / `tauri signer sign` do, so the
 * verifier is exercised against the exact wire format without shipping any private key.
 */
function minisignFixture(file, { prehashed = true, trustedComment = 'timestamp:1\tfile:x' } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawPublic = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const keyId = randomBytes(8);
  const publicKeyFile = `untrusted comment: minisign public key\n${Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    rawPublic,
  ]).toString('base64')}\n`;

  const message = prehashed ? createHash('blake2b512').update(file).digest() : file;
  const signature = sign(null, message, privateKey);
  const globalSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(trustedComment)]),
    privateKey,
  );
  const signatureFile = [
    'untrusted comment: signature from tauri secret key',
    Buffer.concat([Buffer.from(prehashed ? 'ED' : 'Ed'), keyId, signature]).toString('base64'),
    `trusted comment: ${trustedComment}`,
    globalSignature.toString('base64'),
    '',
  ].join('\n');

  return {
    // Tauri stores both files base64-encoded as a whole (tauri.conf.json pubkey, `.sig`).
    pubkey: Buffer.from(publicKeyFile).toString('base64'),
    sig: Buffer.from(signatureFile).toString('base64'),
    publicKeyFile,
    signatureFile,
    keyId: keyId.toString('hex'),
  };
}

describe('parsePublicKey', () => {
  it('accepts the Tauri base64 form and the raw key file', () => {
    const fixture = minisignFixture(Buffer.from('hello'));
    expect(parsePublicKey(fixture.pubkey).keyId).toBe(fixture.keyId);
    expect(parsePublicKey(fixture.publicKeyFile).keyId).toBe(fixture.keyId);
    expect(parsePublicKey(fixture.pubkey).publicKey).toHaveLength(32);
  });

  it('rejects keys of the wrong shape', () => {
    expect(() =>
      parsePublicKey(Buffer.from('untrusted comment: x\nAAAA\n').toString('base64')),
    ).toThrow(/42 bytes/);
  });
});

describe('parseSignature', () => {
  it('reads algorithm, key id and trusted comment', () => {
    const fixture = minisignFixture(Buffer.from('hello'), {
      trustedComment: 'timestamp:42\tfile:a.exe',
    });
    const parsed = parseSignature(fixture.sig);
    expect(parsed.algorithm).toBe('ED');
    expect(parsed.prehashed).toBe(true);
    expect(parsed.keyId).toBe(fixture.keyId);
    expect(parsed.trustedComment).toBe('timestamp:42\tfile:a.exe');
    expect(parsed.signature).toHaveLength(64);
    expect(parsed.globalSignature).toHaveLength(64);
  });

  it('rejects truncated input', () => {
    expect(() => parseSignature('untrusted comment: x\nAAAA\n')).toThrow(/4 lines/);
  });
});

describe('verifyMinisign', () => {
  const file = randomBytes(4096);

  it('accepts a valid prehashed (ED) signature', () => {
    const fixture = minisignFixture(file);
    const verdict = verifyMinisign(
      file,
      parseSignature(fixture.sig),
      parsePublicKey(fixture.pubkey),
    );
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toMatch(/^valid \(ED/);
  });

  it('accepts a valid legacy (Ed) signature', () => {
    const fixture = minisignFixture(file, { prehashed: false });
    expect(
      verifyMinisign(file, parseSignature(fixture.sig), parsePublicKey(fixture.pubkey)).ok,
    ).toBe(true);
  });

  it('rejects a tampered file', () => {
    const fixture = minisignFixture(file);
    const tampered = Buffer.from(file);
    tampered[100] ^= 0xff;
    const verdict = verifyMinisign(
      tampered,
      parseSignature(fixture.sig),
      parsePublicKey(fixture.pubkey),
    );
    expect(verdict).toEqual({ ok: false, reason: 'signature does not match the file' });
  });

  it('rejects a signature from another key', () => {
    const fixture = minisignFixture(file);
    const other = minisignFixture(file);
    const verdict = verifyMinisign(file, parseSignature(fixture.sig), parsePublicKey(other.pubkey));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/key id/);
  });

  it('rejects a modified trusted comment', () => {
    const fixture = minisignFixture(file);
    const forged = fixture.signatureFile.replace('timestamp:1', 'timestamp:2');
    const verdict = verifyMinisign(file, parseSignature(forged), parsePublicKey(fixture.pubkey));
    expect(verdict).toEqual({
      ok: false,
      reason: 'global signature (trusted comment) does not match',
    });
  });
});
