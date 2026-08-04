import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { FORGOT_PASSWORD_EXPIRY_MINUTES, schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { isValidEmail, normalizeEmail } from '@/lib/email-auth';
import { findPasswordRecord } from '@/lib/email-credentials';
import { sendSchoolEmailQuietly } from '@/lib/email-sender';
import { forgotPasswordEmailTemplate } from '@/lib/email-templates';
import { issueEmailVerification, resolvePublicTenant } from '@/lib/email-verifications';

/**
 * POST /api/auth/forgot-password
 *
 * Starts a password reset by sending a code to the address on file. Public.
 *
 * Like `send-otp-email`, the response never distinguishes a known address from
 * an unknown one — and here the reason is sharper: a "no such account" reply
 * would let anyone confirm who works at a school by trying addresses, which is
 * the reconnaissance step before every credential-stuffing attempt.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ForgotBody {
  email?: unknown;
  locationId?: unknown;
}

const NEUTRAL_MESSAGE =
  'If that address has an account, a reset code is on its way. It expires in 15 minutes.';

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<ForgotBody>(request);
    const email = normalizeEmail(typeof body?.email === 'string' ? body.email : '');

    if (!isValidEmail(email)) {
      return apiFailure('invalid_email', 'Enter a valid email address.', 400);
    }

    const tenant = await resolvePublicTenant(request, body?.locationId);
    if (tenant === null) {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const record = await findPasswordRecord(email, tenant.locationId);
    if (record === null) {
      return apiSuccess({ message: NEUTRAL_MESSAGE });
    }

    const issued = await issueEmailVerification({
      locationId: tenant.locationId,
      email,
      type: 'forgot_password',
      expiryMinutes: FORGOT_PASSWORD_EXPIRY_MINUTES,
    });

    if (issued.status === 'rate_limited') {
      return apiFailure(
        'rate_limited',
        `Too many reset codes requested. Try again in ${Math.ceil(issued.retryAfterSeconds / 60)} minute(s).`,
        429,
      );
    }

    // Only for the greeting. A missing name is not a reason to withhold the
    // reset, so it falls back to something neutral rather than failing.
    const nameRows = await db
      .select({ name: schoolUsers.name })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, tenant.locationId),
          eq(schoolUsers.firebaseUid, record.firebaseUid),
        ),
      )
      .limit(1);

    await sendSchoolEmailQuietly({
      locationId: tenant.locationId,
      to: email,
      fromName: tenant.name,
      ...forgotPasswordEmailTemplate({
        schoolName: tenant.name,
        recipientName: nameRows[0]?.name ?? 'there',
        otp: issued.otp,
        expiryMinutes: FORGOT_PASSWORD_EXPIRY_MINUTES,
      }),
    });

    return apiSuccess({ message: NEUTRAL_MESSAGE });
  } catch (error) {
    return handleApiError(error);
  }
}
