import 'server-only';

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { compare, hash } from 'bcryptjs';

/**
 * Password and one-time-proof primitives for email authentication.
 *
 * Deliberately free of database and Firebase imports: everything here is pure
 * enough to reason about on its own, which is what makes the routes that
 * compose it readable.
 *
 * The rules a browser also needs — password strength, address shape — live in
 * `lib/password-strength.ts` and are re-exported here, so a route imports one
 * module and the strength meter beside the field cannot drift from the check
 * that accepts the password.
 */

export {
  isValidEmail,
  normalizeEmail,
  passwordScore,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
  type PasswordStrengthResult,
} from './password-strength';

/**
 * bcrypt cost for passwords.
 *
 * Higher than the 10 used for OTPs in `lib/otp.ts`, and for a different threat:
 * a six-digit code lives ten minutes and is bounded by an attempt cap, whereas
 * a password survives until someone changes it. Cost 12 is roughly a quarter of
 * a second per verification — a cheap price on a login, an expensive one at
 * scale for an attacker holding a stolen table.
 */
export const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  // bcryptjs rejects a malformed hash by throwing; a corrupt row must read as
  // "wrong password", never as a 500 that tells the caller the row exists.
  try {
    return await compare(plain, hashed);
  } catch {
    return false;
  }
}

/**
 * Six digits from a CSPRNG.
 *
 * `randomInt` is uniform over the range; `Math.random` is neither uniform nor
 * unpredictable, and a predictable login code is not a code at all.
 */
export function generateOTP(): string {
  return randomInt(100000, 1000000).toString().padStart(6, '0');
}

/** 32 random bytes, hex encoded — the credential inside an invitation link. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function getOTPExpiry(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Constant-time comparison for the two secrets that arrive as plain text: the
 * OTP and the invitation token.
 *
 * Both are compared against a value read from our own database rather than
 * against a hash, so `===` would leak their contents one byte at a time to
 * anyone able to measure the response. The length check before it is not a
 * leak: the length of a six-digit code and a 64-character token is public.
 */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Burns roughly as long as a real bcrypt verification would.
 *
 * Called on the "no such account" path so that an unknown address and a wrong
 * password take comparable time. Without it the 401 for an address that has no
 * row comes back in a millisecond and the one for a real account in a quarter
 * of a second, which is an account-enumeration oracle wearing an identical
 * error message.
 */
let decoyHash: Promise<string> | null = null;

export async function burnPasswordTiming(): Promise<void> {
  // Hashed once per process rather than written as a literal: a hard-coded
  // digest that turned out to be malformed would be rejected in microseconds
  // and this function would silently stop doing its job.
  decoyHash ??= hash('timing-equaliser', BCRYPT_ROUNDS);

  try {
    await compare('timing-equaliser-miss', await decoyHash);
  } catch {
    // Nothing to report: this call exists for its duration, not its result.
  }
}
