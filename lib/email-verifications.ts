import 'server-only';

import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import {
  emailVerifications,
  schools,
  EMAIL_OTP_MAX_ATTEMPTS,
  EMAIL_OTP_MAX_SENDS,
  EMAIL_OTP_SEND_WINDOW_MINUTES,
  type EmailVerification,
  type EmailVerificationType,
} from '@/db/schema';

import { db } from './drizzle';
import { generateOTP, generateToken, getOTPExpiry, secretsMatch } from './email-auth';
import { SCHOOL_LOCATION_HEADER, SCHOOL_SLUG_HEADER } from './school-context';

/**
 * The lifecycle of every short-lived proof sent to an inbox.
 *
 * One row per (school, email, type), so issuing a code supersedes the previous
 * one rather than living alongside it. Without that, tapping "resend" three
 * times would leave three live codes for one account and triple the guessing
 * surface for no benefit — the person is only ever going to type the newest.
 *
 * Everything that bounds abuse is here rather than in the routes, so the eight
 * public endpoints cannot each get it subtly wrong:
 *
 *   - sends per address per window   (`issueEmailVerification`)
 *   - wrong guesses before the proof is burned  (`verifyEmailOtp`)
 *   - single use     (`markVerificationUsed`, and the burn on the last guess)
 *   - expiry         (per type, from the caller)
 */

export interface ResolvedTenant {
  locationId: string;
  slug: string;
  name: string;
}

/**
 * Which school is this unauthenticated request for?
 *
 * Order matters. Middleware resolves the tenant from the hostname (or the dev
 * `?school=` parameter) and stamps it on the request, and that is the value to
 * trust — it cannot be chosen by whoever is posting the body. The `locationId`
 * in the body is a fallback for deployments where no subdomain carries the
 * tenant, and it is looked up rather than believed: an id naming no active
 * school resolves to null.
 *
 * Choosing a tenant is not entering one. Every route below still checks the
 * credential against that school's own rows, exactly as `withSchoolAuth` does.
 */
export async function resolvePublicTenant(
  request: NextRequest,
  bodyLocationId: unknown,
): Promise<ResolvedTenant | null> {
  const headerLocationId = request.headers.get(SCHOOL_LOCATION_HEADER);
  if (headerLocationId !== null && headerLocationId !== '') {
    return lookupTenant(eq(schools.locationId, headerLocationId));
  }

  const slug = request.headers.get(SCHOOL_SLUG_HEADER);
  if (slug !== null && slug !== '') {
    return lookupTenant(eq(schools.slug, slug));
  }

  if (typeof bodyLocationId === 'string' && bodyLocationId.trim() !== '') {
    return lookupTenant(eq(schools.locationId, bodyLocationId.trim()));
  }

  return null;
}

async function lookupTenant(match: SQL): Promise<ResolvedTenant | null> {
  const rows = await db
    .select({
      locationId: schools.locationId,
      slug: schools.slug,
      name: schools.name,
    })
    .from(schools)
    .where(and(match, eq(schools.isActive, true)))
    .limit(1);

  return rows[0] ?? null;
}

export interface IssueVerificationParams {
  locationId: string;
  email: string;
  type: EmailVerificationType;
  expiryMinutes: number;
}

export type IssueVerificationResult =
  | { status: 'issued'; token: string; otp: string; expiresAt: Date }
  | { status: 'rate_limited'; retryAfterSeconds: number };

/**
 * Issues a fresh proof, superseding whatever was outstanding for this address.
 *
 * The send rate limit lives on the surviving row rather than in a count of
 * rows, because the unique index means there is only ever one row to count.
 * `windowStartedAt` is the start of the current allowance and resets once it
 * has elapsed, so three sends in a minute is refused and three sends across an
 * afternoon is not.
 */
export async function issueEmailVerification(
  params: IssueVerificationParams,
): Promise<IssueVerificationResult> {
  const { locationId, email, type, expiryMinutes } = params;
  const now = new Date();
  const windowMs = EMAIL_OTP_SEND_WINDOW_MINUTES * 60 * 1000;

  const existing = await findVerification(locationId, email, type);

  let sendCount = 1;
  let windowStartedAt = now;

  if (existing !== null) {
    const windowAge = now.getTime() - existing.windowStartedAt.getTime();

    if (windowAge < windowMs) {
      if (existing.sendCount >= EMAIL_OTP_MAX_SENDS) {
        return {
          status: 'rate_limited',
          retryAfterSeconds: Math.max(1, Math.ceil((windowMs - windowAge) / 1000)),
        };
      }

      sendCount = existing.sendCount + 1;
      windowStartedAt = existing.windowStartedAt;
    }
  }

  const token = generateToken();
  const otp = generateOTP();
  const expiresAt = getOTPExpiry(expiryMinutes);

  await db
    .insert(emailVerifications)
    .values({
      locationId,
      email,
      token,
      otp,
      type,
      expiresAt,
      sendCount,
      windowStartedAt,
    })
    .onConflictDoUpdate({
      target: [
        emailVerifications.locationId,
        emailVerifications.email,
        emailVerifications.type,
      ],
      set: {
        token,
        otp,
        expiresAt,
        // A superseded proof starts clean: new code, no spent guesses, and the
        // previous `used_at` cleared so this row is live again.
        usedAt: null,
        attempts: 0,
        sendCount,
        windowStartedAt,
        createdAt: now,
      },
    });

  return { status: 'issued', token, otp, expiresAt };
}

export async function findVerification(
  locationId: string,
  email: string,
  type: EmailVerificationType,
): Promise<EmailVerification | null> {
  const rows = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.locationId, locationId),
        eq(emailVerifications.email, email),
        eq(emailVerifications.type, type),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Looks a proof up by the token carried in an invitation link. */
export async function findVerificationByToken(
  locationId: string,
  token: string,
  type: EmailVerificationType,
): Promise<EmailVerification | null> {
  const rows = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.locationId, locationId),
        eq(emailVerifications.token, token),
        eq(emailVerifications.type, type),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type OtpVerdict =
  | { status: 'valid'; verification: EmailVerification }
  | { status: 'invalid'; attemptsLeft: number }
  | { status: 'expired' }
  | { status: 'max_attempts' };

export interface VerifyOtpParams {
  locationId: string;
  email: string;
  type: EmailVerificationType;
  otp: string;
  /** Binds the code to one invitation link, when there is one. */
  token?: string | undefined;
}

/**
 * Checks a code against the live proof for this address.
 *
 * The attempt is counted *before* the comparison, so a request abandoned
 * mid-verify cannot be used to buy a free guess. On the last allowed guess the
 * row is burned outright rather than merely refused: leaving a token that has
 * survived five wrong codes alive for another ten minutes is the one thing the
 * attempt cap exists to prevent.
 *
 * A missing row, an expired one and a spent one all report `expired`. From the
 * caller's side they mean the same thing, and distinguishing them would confirm
 * whether an address has a code in flight.
 */
export async function verifyEmailOtp(params: VerifyOtpParams): Promise<OtpVerdict> {
  const { locationId, email, type, otp, token } = params;

  const verification = await findVerification(locationId, email, type);

  if (verification === null) return { status: 'expired' };
  if (verification.usedAt !== null) return { status: 'expired' };
  if (verification.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
  if (verification.attempts >= EMAIL_OTP_MAX_ATTEMPTS) return { status: 'max_attempts' };

  // A code issued for this address still must not complete a *different*
  // invitation link.
  if (token !== undefined && !secretsMatch(token, verification.token)) {
    return { status: 'expired' };
  }

  const attempts = verification.attempts + 1;

  await db
    .update(emailVerifications)
    .set({ attempts: sql`${emailVerifications.attempts} + 1` })
    .where(eq(emailVerifications.id, verification.id));

  if (secretsMatch(otp, verification.otp)) {
    return { status: 'valid', verification: { ...verification, attempts } };
  }

  if (attempts >= EMAIL_OTP_MAX_ATTEMPTS) {
    await markVerificationUsed(verification.id);
    return { status: 'max_attempts' };
  }

  return { status: 'invalid', attemptsLeft: EMAIL_OTP_MAX_ATTEMPTS - attempts };
}

/** Stamps a proof as spent. A spent proof can never verify again. */
export async function markVerificationUsed(id: string): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ usedAt: new Date() })
    .where(eq(emailVerifications.id, id));
}

/** Drops a proof outright — used once the account it created exists. */
export async function deleteVerification(id: string): Promise<void> {
  await db.delete(emailVerifications).where(eq(emailVerifications.id, id));
}
