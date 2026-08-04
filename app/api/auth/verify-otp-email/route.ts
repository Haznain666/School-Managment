import type { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import { findPasswordRecord } from '@/lib/email-credentials';
import {
  applySessionCookie,
  establishEmailSession,
  loadMemberIdentity,
} from '@/lib/email-session';
import {
  markVerificationUsed,
  resolvePublicTenant,
  verifyEmailOtp,
} from '@/lib/email-verifications';

/**
 * POST /api/auth/verify-otp-email
 *
 * Completes an OTP sign-in. Public, and the code is the whole credential — so
 * everything that bounds it lives in `verifyEmailOtp`: five guesses, ten
 * minutes, single use, and the token burned outright on the last wrong guess.
 *
 * On success this issues the same session cookie as password sign-in. A
 * passcode and a password are two ways of proving the same thing, and neither
 * grants more than the other.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VerifyBody {
  email?: unknown;
  otp?: unknown;
  locationId?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<VerifyBody>(request);
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';

    if (!isValidEmail(email)) {
      return apiFailure('invalid_email', 'Enter a valid email address.', 400);
    }
    if (otp === '') {
      return apiFailure('invalid_body', 'Enter the six-digit code from your email.', 400);
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    if (tenant === null) {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const verdict = await verifyEmailOtp({
      locationId: tenant.locationId,
      email,
      type: 'otp_login',
      otp,
    });

    if (verdict.status === 'expired') {
      return apiFailure('otp_expired', 'That code has expired. Request a new one.', 410);
    }
    if (verdict.status === 'max_attempts') {
      return apiFailure(
        'otp_max_attempts',
        'Too many incorrect codes. Request a new one.',
        429,
      );
    }
    if (verdict.status === 'invalid') {
      return apiFailure(
        'otp_invalid',
        `Incorrect code. ${verdict.attemptsLeft} attempt(s) left.`,
        401,
      );
    }

    // Spent before the session is minted, so a replay of this exact request
    // cannot produce a second one.
    await markVerificationUsed(verdict.verification.id);

    const record = await findPasswordRecord(email, tenant.locationId);
    if (record === null) {
      return apiFailure(
        'account_disabled',
        'Your account is not active. Contact your school administrator.',
        403,
      );
    }

    const identity = await loadMemberIdentity(record.locationId, record.firebaseUid);
    if (identity === null) {
      return apiFailure(
        'account_disabled',
        'Your account is not active. Contact your school administrator.',
        403,
      );
    }

    const session = await establishEmailSession(record.locationId, identity);

    const response = apiSuccess({
      redirect: session.redirect,
      role: session.role,
      name: session.name,
      mustChangePassword: record.mustChangePassword,
    });

    applySessionCookie(response, session);
    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
