import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { requireServerEnv } from './env';

/**
 * AES-256-GCM encryption for secrets held at rest — currently GHL OAuth tokens
 * (CRITICAL RULE #5).
 *
 * Ciphertext format (all base64url, dot-separated):
 *   v1.<iv>.<authTag>.<ciphertext>
 * The version prefix lets us rotate algorithms later without ambiguity.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const VERSION = 'v1';

let cachedKey: Buffer | null = null;

/**
 * Decodes ENCRYPTION_KEY. Accepts base64 or hex; either way it must decode to
 * exactly 32 bytes.
 */
function getKey(): Buffer {
  if (cachedKey !== null) return cachedKey;

  const raw = requireServerEnv('ENCRYPTION_KEY').trim();

  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${decoded.length}). ` +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }

  cachedKey = decoded;
  return cachedKey;
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/** Encrypts a UTF-8 string. Returns the versioned, self-describing envelope. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypts an envelope produced by `encrypt`.
 * Throws `DecryptionError` if the payload is malformed or has been tampered
 * with (GCM authentication failure) — never returns a partial result.
 */
export function decrypt(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new DecryptionError('Malformed ciphertext envelope.');
  }

  const [version, ivPart, tagPart, dataPart] = parts;
  if (version !== VERSION || ivPart === undefined || tagPart === undefined || dataPart === undefined) {
    throw new DecryptionError(`Unsupported ciphertext version "${version ?? ''}".`);
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Deliberately opaque: never leak which part failed.
    throw new DecryptionError('Failed to decrypt payload.');
  }
}

/** Constant-time string comparison for secrets (webhook signatures, etc.). */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
