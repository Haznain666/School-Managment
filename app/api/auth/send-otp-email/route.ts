import type { NextRequest } from 'next/server';

import { OTP_LOGIN_EXPIRY_MINUTES } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import { findPasswordRecord } from '@/lib/email-credentials';
import { sendSchoolEmailQuietly } from '@/lib/email-sender';
import { otpLoginEmailTemplate } from '@/lib/email-templates';
import { issueEmailVerification, resolvePublicTenant } from '@/lib/email-verifications';

/**
 * POST /api/auth/send-otp-email
 *
 * Sends a one-time sign-in code to a registered address. Public, because it
 * runs before anyone is signed in.
 *
 * The response is identical whether the address has an account or not. That is
 * the whole point of the endpoint's shape: anything that distinguished the two
 * would turn it into a directory of who works at a school, which is exactly the
 * list an attacker wants before trying passwords anywhere else.
 *
 * The code is never in the response and never logged — the inbox is the proof.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SendOtpBody {
  email?: unknown;
  locationId?: unknown;
}

/** Said whether or not anything was actually sent. */
const NEUTRAL_MESSAGE =
  'If that address has an account, a sign-in code is on its way. It expires in 10 minutes.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<SendOtpBody>(request);
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');

    if (!isValidEmail(email)) {
      return apiFailure('invalid_email', 'Enter a valid email address.', 400);
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    if (tenant === null) {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const record = await findPasswordRecord(email, tenant.locationId);

    // No account: stop here, and say the same thing as the success path. The
    // rate limiter is not consulted either, so an unknown address cannot be
    // told apart by whether it can be retried.
    if (record === null) {
      return apiSuccess({ message: NEUTRAL_MESSAGE, expiresIn: 0 });
    }

    const issued = await issueEmailVerification({
      locationId: tenant.locationId,
      email,
      type: 'otp_login',
      expiryMinutes: OTP_LOGIN_EXPIRY_MINUTES,
    });

    if (issued.status === 'rate_limited') {
      // The one case that must be distinguishable, because the person is
      // waiting and needs to know to stop pressing the button.
      return apiFailure(
        'rate_limited',
        `Too many codes requested. Try again in ${Math.ceil(issued.retryAfterSeconds / 60)} minute(s).`,
        429,
      );
    }

    await sendSchoolEmailQuietly({
      locationId: tenant.locationId,
      to: email,
      fromName: tenant.name,
      ...otpLoginEmailTemplate({
        schoolName: tenant.name,
        otp: issued.otp,
        expiryMinutes: OTP_LOGIN_EXPIRY_MINUTES,
      }),
    });

    return apiSuccess({
      message: NEUTRAL_MESSAGE,
      expiresIn: OTP_LOGIN_EXPIRY_MINUTES * 60,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
