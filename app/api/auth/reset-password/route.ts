import type { NextRequest, NextResponse } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  hashPassword,
  isValidEmail,
  normalizeEmail,
  secretsMatch,
  validatePasswordStrength,
} from '@/lib/email-auth';
import { findPasswordRecord, upsertPassword } from '@/lib/email-credentials';
import { clearSessionCookie } from '@/lib/email-session';
import {
  findVerificationByToken,
  markVerificationUsed,
  resolvePublicTenant,
} from '@/lib/email-verifications';
import { revokeSchoolSession } from '@/lib/school-auth';

/**
 * POST /api/auth/reset-password
 *
 * Sets a new password using the token `/api/auth/verify-forgot-otp` handed
 * back. Public — the token is the credential.
 *
 * ── On invalidating sessions ─────────────────────────────────────────────
 * A reset is the one moment when the person changing the password may not be
 * the person holding the sessions. So both halves are cut: `revokeSchoolSession`
 * revokes every refresh token, which makes the session cookie on every other
 * device fail its next verification (`verifySessionCookie(cookie, true)` checks
 * revocation), and the cookie on *this* browser is cleared outright. The reply
 * asks them to sign in again rather than signing them in, which is the whole
 * point: proving you can read an inbox should not silently hand you a session.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ResetBody {
  email?: unknown;
  resetToken?: unknown;
  newPassword?: unknown;
  confirmPassword?: unknown;
  locationId?: unknown;
}

/** Said for a bad token, a spent one and an expired one alike. */
const INVALID_TOKEN =
  'This reset link is no longer valid. Request a new code and try again.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<ResetBody>(request);
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const resetToken = typeof body?.resetToken === 'string' ? body.resetToken.trim() : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    const confirmPassword =
      typeof body?.confirmPassword === 'string' ? body.confirmPassword : '';

    if (!isValidEmail(email) || resetToken === '') {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    if (newPassword !== confirmPassword) {
      return apiFailure('password_mismatch', 'The two passwords do not match.', 400);
    }

    const strength = validatePasswordStrength(newPassword);
    if (!strength.valid) {
      return apiFailure('weak_password', strength.error ?? 'Choose a stronger password.', 400);
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    if (tenant === null) {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const verification = await findVerificationByToken(
      tenant.locationId,
      resetToken,
      'forgot_password',
    );

    if (
      verification === null ||
      verification.usedAt !== null ||
      verification.expiresAt.getTime() <= Date.now() ||
      // The token identifies the row; the address must be the row's own. Without
      // this, a token issued for one person could set another's password.
      !secretsMatch(verification.email, email)
    ) {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    const record = await findPasswordRecord(email, tenant.locationId);
    if (record === null) {
      return apiFailure('invalid_token', INVALID_TOKEN, 400);
    }

    // Spent before the password is written, so a replay of this request cannot
    // set a second password of the caller's choosing.
    await markVerificationUsed(verification.id);

    await upsertPassword({
      locationId: tenant.locationId,
      email,
      firebaseUid: record.firebaseUid,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
    });

    try {
      await revokeSchoolSession(record.firebaseUid);
    } catch (error) {
      // Every other device keeps its cookie until expiry, which is worth a loud
      // log — but the password itself is already changed, and reporting failure
      // here would tell the user the reset did not happen when it did.
      console.error('[reset-password] could not revoke existing sessions:', error);
    }

    const response = apiSuccess({
      message: 'Password updated. Please log in with your new password.',
    });

    clearSessionCookie(response);
    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
