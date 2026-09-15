// Minisign verification in plain Node (no dependency) for `release:verify`. Tauri's updater
// signs with minisign (`tauri signer sign`) and ships the signature file base64-encoded, both in
// `<installer>.sig` and in `latest.json#platforms.*.signature`. The Tauri CLI has no `verify`
// command, so this re-implements the check: https://jedisct1.github.io/minisign/#signature-format
//
//   untrusted comment: <text>
//   base64(<sig_alg 2 bytes><key_id 8 bytes><signature 64 bytes>)
//   trusted comment: <text>
//   base64(<global_signature 64 bytes>)
//
// `ED` = signature over BLAKE2b-512(file) (prehashed, what rsign2 / Tauri emit); `Ed` = over the
// file itself. The global signature covers `signature || trusted comment`.
import { createHash, createPublicKey, verify } from 'node:crypto';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Decodes a Tauri `pubkey` (base64 of the minisign public key file) or a raw minisign key file. */
export function parsePublicKey(text) {
  const decoded = looksLikeBase64(text) ? Buffer.from(text, 'base64').toString('utf8') : text;
  const lines = decoded.split(/\r?\n/).filter((line) => line.length > 0);
  const keyLine = lines.find((line) => !line.startsWith('untrusted comment:'));
  if (!keyLine) throw new Error('minisign public key: no key line found');
  const bytes = Buffer.from(keyLine, 'base64');
  if (bytes.length !== 42 || bytes.toString('latin1', 0, 2) !== 'Ed') {
    throw new Error(
      `minisign public key: expected 42 bytes starting with "Ed", got ${bytes.length}`,
    );
  }
  return {
    keyId: bytes.subarray(2, 10).toString('hex'),
    publicKey: bytes.subarray(10, 42),
  };
}

/** Decodes a Tauri `.sig` payload (base64 of the minisign signature file) or a raw signature file. */
export function parseSignature(text) {
  const decoded = looksLikeBase64(text) ? Buffer.from(text, 'base64').toString('utf8') : text;
  const lines = decoded.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 4) throw new Error('minisign signature: expected 4 lines');
  const [untrusted, signatureLine, trusted, globalLine] = lines;
  if (!untrusted.startsWith('untrusted comment:') || !trusted.startsWith('trusted comment:')) {
    throw new Error('minisign signature: comment lines are malformed');
  }
  const signature = Buffer.from(signatureLine, 'base64');
  const globalSignature = Buffer.from(globalLine, 'base64');
  if (signature.length !== 74) {
    throw new Error(`minisign signature: expected 74 bytes, got ${signature.length}`);
  }
  if (globalSignature.length !== 64) {
    throw new Error(`minisign signature: expected a 64-byte global signature`);
  }
  const algorithm = signature.toString('latin1', 0, 2);
  if (algorithm !== 'ED' && algorithm !== 'Ed') {
    throw new Error(`minisign signature: unknown algorithm "${algorithm}"`);
  }
  return {
    algorithm,
    prehashed: algorithm === 'ED',
    keyId: signature.subarray(2, 10).toString('hex'),
    signature: signature.subarray(10, 74),
    trustedComment: trusted.slice('trusted comment:'.length).trimStart(),
    globalSignature,
  };
}

/**
 * Verifies `file` (Buffer) against a parsed signature and public key. Returns `{ ok, reason }`
 * instead of throwing so callers can report every artifact.
 */
export function verifyMinisign(file, signature, publicKey) {
  if (signature.keyId !== publicKey.keyId) {
    return { ok: false, reason: `key id ${signature.keyId} does not match ${publicKey.keyId}` };
  }
  const key = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey.publicKey]),
    format: 'der',
    type: 'spki',
  });
  const message = signature.prehashed ? createHash('blake2b512').update(file).digest() : file;
  if (!verify(null, message, key, signature.signature)) {
    return { ok: false, reason: 'signature does not match the file' };
  }
  const globalMessage = Buffer.concat([
    signature.signature,
    Buffer.from(signature.trustedComment, 'utf8'),
  ]);
  if (!verify(null, globalMessage, key, signature.globalSignature)) {
    return { ok: false, reason: 'global signature (trusted comment) does not match' };
  }
  return { ok: true, reason: `valid (${signature.algorithm}, key ${signature.keyId})` };
}

function looksLikeBase64(text) {
  const trimmed = text.trim();
  return trimmed.length > 0 && !trimmed.includes('\n') && /^[A-Za-z0-9+/=]+$/.test(trimmed);
}
