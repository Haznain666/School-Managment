import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import { resolvePublicTenant, verifyEmailOtp } from '@/lib/email-verifications';

/**
 * POST /api/auth/verify-forgot-otp
 *
 * Checks a reset code and hands back the row's token as proof for the next
 * step. Public.
 *
 * ── Why the proof is not consumed here ───────────────────────────────────
 * Choosing a new password is a second request, and marking the code spent now
 * would leave a person who mistypes their new password holding a burnt code and
 * no way forward but to start again. So the code is verified, the token is
 * returned, and `/api/auth/reset-password` is what stamps `used_at`.
 *
 * The token is safe to hand over precisely because the code was just proved:
 * it is 32 random bytes that only this response reveals, it dies with the same
 * fifteen-minute expiry, and it buys exactly one thing — setting the password
 * on the address that received the mail.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VerifyForgotBody {
  email?: unknown;
  otp?: unknown;
  locationId?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<VerifyForgotBody>(request);
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
      type: 'forgot_password',
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

    return apiSuccess({
      verified: true,
      resetToken: verdict.verification.token,
      expiresAt: verdict.verification.expiresAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
