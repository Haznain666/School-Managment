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

/** Also said whether or not anything was sent. See the note at the null check. */
const SENT_RESPONSE_EXPIRES_IN = OTP_LOGIN_EXPIRY_MINUTES * 60;

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

    // No account: stop here, and return a byte-identical response to the
    // success path. `expiresIn` is part of that — a 0 here and a 600 below
    // would answer "does this address have an account" in a single request,
    // which is the exact question the shared message exists to refuse.
    if (record === null) {
      return apiSuccess({ message: NEUTRAL_MESSAGE, expiresIn: SENT_RESPONSE_EXPIRES_IN });
    }

    const issued = await issueEmailVerification({
      locationId: tenant.locationId,
      email,
      type: 'otp_login',
      expiryMinutes: OTP_LOGIN_EXPIRY_MINUTES,
    });

    /**
     * Over the send allowance: no new code is issued and no mail goes out, but
     * the reply is the neutral one rather than a 429.
     *
     * A 429 here would be an enumeration oracle of exactly the kind the shared
     * message exists to close — it is only ever reachable for an address that
     * has an account, so four requests would answer the question that one
     * request no longer does.
     *
     * Nobody is stranded by the silence: the code from the previous send is
     * still live and still in their inbox, because a refused send leaves the
     * existing row untouched. "A code is on its way" remains true.
     */
    if (issued.status === 'rate_limited') {
      return apiSuccess({ message: NEUTRAL_MESSAGE, expiresIn: SENT_RESPONSE_EXPIRES_IN });
    }

    // Return value ignored on purpose: reporting whether delivery succeeded
    // would report whether there was anyone to deliver to.
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
      expiresIn: SENT_RESPONSE_EXPIRES_IN,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
