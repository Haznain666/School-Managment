import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import {
  markVerificationUsed,
  resolvePublicTenant,
  verifyEmailOtp,
} from '@/lib/email-verifications';

/**
 * POST /api/auth/verify-invitation
 *
 * First half of accepting an invitation: prove the code that arrived in the
 * inbox. Public — the link and the code together are the credential.
 *
 * Both halves are required. The token identifies which invitation this is and
 * travels in the URL, so anyone who intercepts the link has it; the code is
 * typed by the person and only exists in the message body. Requiring both is
 * what makes a forwarded link on its own useless.
 *
 * The proof is marked used here rather than at the end. `/api/auth/set-password`
 * then accepts it for a short grace period, which is what turns "verify, then
 * choose a password" into two requests without leaving a live invitation token
 * in flight after the code has been spent.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VerifyInvitationBody {
  token?: unknown;
  email?: unknown;
  otp?: unknown;
  locationId?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<VerifyInvitationBody>(request);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';

    if (token === '' || !isValidEmail(email)) {
      return apiFailure(
        'invalid_invitation',
        'This invitation link is not valid. Ask your school administrator to send a new one.',
        400,
      );
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
      type: 'invitation',
      otp,
      token,
    });

    if (verdict.status === 'expired') {
      return apiFailure(
        'invitation_expired',
        'This invitation has expired. Ask your school administrator to send a new one.',
        410,
      );
    }
    if (verdict.status === 'max_attempts') {
      return apiFailure(
        'otp_max_attempts',
        'Too many incorrect codes. Ask your school administrator to send a new invitation.',
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

    await markVerificationUsed(verdict.verification.id);

    return apiSuccess({ verified: true, token: verdict.verification.token });
  } catch (error) {
    return handleApiError(error);
  }
}
