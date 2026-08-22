import 'server-only';

import { randomInt } from 'node:crypto';

import { compare, hash } from 'bcryptjs';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { authOtpSessions, type OtpPurpose } from '@/db/schema';

import type { Database } from './drizzle';

/**
 * One-time passcode lifecycle.
 *
 * Codes are six digits, so they must be defended in depth rather than by
 * entropy alone: short expiry, a hard attempt cap, single use, and only a
 * bcrypt hash at rest.
 *
 * The plaintext code exists in exactly one place — the return value of
 * `createOTPSession`, on its way to the invitee's mailbox. It is never logged, never
 * returned from an API route, and never stored.
 */

export const OTP_EXPIRY_MINUTES = readPositiveInt(
  process.env['OTP_EXPIRY_MINUTES'],
  10,
);
export const OTP_MAX_ATTEMPTS = readPositiveInt(process.env['OTP_MAX_ATTEMPTS'], 3);

/** bcrypt cost. 10 keeps verification well under the request budget. */
const BCRYPT_ROUNDS = 10;

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Six digits from a CSPRNG. `randomInt` is uniform; `Math.random` is not. */
export function generateOTP(): string {
  return randomInt(100000, 1000000).toString().padStart(6, '0');
}

export function hashOTP(otp: string): Promise<string> {
  return hash(otp, BCRYPT_ROUNDS);
}

export function verifyOTPHash(otp: string, otpHash: string): Promise<boolean> {
  return compare(otp, otpHash);
}

export interface CreateOtpParams {
  locationId: string;
  /** E.164, already normalised. */
  phone: string;
  purpose: OtpPurpose;
  inviteToken?: string | undefined;
}

/**
 * Issues a passcode, invalidating any earlier one for the same
 * phone + school + purpose.
 *
 * Superseding matters: without it, requesting a second code would leave the
 * first one live, doubling the guessing surface for the same account.
 *
 * @returns the plaintext code, for immediate delivery. Do not log or persist it.
 */
export async function createOTPSession(
  db: Database,
  params: CreateOtpParams,
): Promise<{ otp: string; expiresAt: Date }> {
  await db
    .update(authOtpSessions)
    .set({ expiresAt: new Date() })
    .where(
      and(
        eq(authOtpSessions.locationId, params.locationId),
        eq(authOtpSessions.phone, params.phone),
        eq(authOtpSessions.purpose, params.purpose),
        isNull(authOtpSessions.usedAt),
      ),
    );

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await db.insert(authOtpSessions).values({
    locationId: params.locationId,
    phone: params.phone,
    otpHash,
    purpose: params.purpose,
    inviteToken: params.inviteToken ?? null,
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
  });

  return { otp, expiresAt };
}

export type OtpVerdict = 'valid' | 'invalid' | 'expired' | 'max_attempts';

export interface VerifyOtpParams {
  locationId: string;
  phone: string;
  otp: string;
  purpose: OtpPurpose;
  inviteToken?: string | undefined;
}

/**
 * Checks a passcode and consumes it on success.
 *
 * `expired` covers "no live session" as well as a lapsed one — from the
 * caller's side both mean the same thing, and not distinguishing them avoids
 * confirming whether a number has a session in flight.
 */
export async function verifyOTPSession(
  db: Database,
  params: VerifyOtpParams,
): Promise<OtpVerdict> {
  const conditions = [
    eq(authOtpSessions.locationId, params.locationId),
    eq(authOtpSessions.phone, params.phone),
    eq(authOtpSessions.purpose, params.purpose),
    isNull(authOtpSessions.usedAt),
    gt(authOtpSessions.expiresAt, new Date()),
  ];

  // Binds the code to one invitation, so a login code cannot complete a signup.
  if (params.inviteToken !== undefined) {
    conditions.push(eq(authOtpSessions.inviteToken, params.inviteToken));
  }

  const rows = await db
    .select()
    .from(authOtpSessions)
    .where(and(...conditions))
    .orderBy(desc(authOtpSessions.createdAt))
    .limit(1);

  const session = rows[0];
  if (session === undefined) return 'expired';

  if (session.attempts >= session.maxAttempts) return 'max_attempts';

  // Count the attempt before checking it, so a crash mid-verify cannot be used
  // to get a free guess.
  await db
    .update(authOtpSessions)
    .set({ attempts: sql`${authOtpSessions.attempts} + 1` })
    .where(eq(authOtpSessions.id, session.id));

  const matches = await verifyOTPHash(params.otp, session.otpHash);
  if (!matches) return 'invalid';

  await db
    .update(authOtpSessions)
    .set({ usedAt: new Date() })
    .where(eq(authOtpSessions.id, session.id));

  return 'valid';
}
