import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { createOTPSession, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { maskEmail, OtpDeliveryError, sendLoginOTP } from '@/lib/otp-sender';
import { InvalidPhoneError, maskPhone, normalizePhone } from '@/lib/phone';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';

/**
 * POST /api/school/auth/otp/request
 *
 * Sends a login passcode to a registered number, over WhatsApp where possible
 * and by email when it is not. Unauthenticated by necessity — it runs before
 * anyone is signed in.
 *
 * The passcode is never returned in the response and never logged: possession
 * of the handset or inbox is the whole proof, so revealing it anywhere else
 * defeats the mechanism.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RequestBody {
  phone?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<RequestBody>(request);
    const rawPhone = typeof body?.phone === 'string' ? body.phone : '';

    let phone: string;
    try {
      phone = normalizePhone(rawPhone);
    } catch (error) {
      if (error instanceof InvalidPhoneError) {
        return apiFailure(
          'invalid_phone',
          'Enter a valid Pakistani mobile number, for example 0300-1234567.',
          400,
        );
      }
      throw error;
    }

    const userRows = await db
      .select({
        name: schoolUsers.name,
        email: schoolUsers.email,
        isActive: schoolUsers.isActive,
      })
      .from(schoolUsers)
      .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.phone, phone)))
      .limit(1);

    const user = userRows[0];

    if (user === undefined) {
      return apiFailure(
        'not_found',
        'No account found with this number. Check your invite link.',
        404,
      );
    }

    if (!user.isActive) {
      return apiFailure(
        'account_disabled',
        'Account deactivated. Contact your school admin.',
        403,
      );
    }

    const schoolRows = await db
      .select({ name: schools.name })
      .from(schools)
      .where(and(eq(schools.locationId, locationId), eq(schools.isActive, true)))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    const { otp } = await createOTPSession(db, {
      locationId,
      phone,
      purpose: 'login',
    });

    let channel;
    try {
      ({ channel } = await sendLoginOTP({
        db,
        locationId,
        phone,
        email: user.email,
        name: user.name,
        schoolName: school.name,
        otp,
      }));
    } catch (error) {
      if (error instanceof OtpDeliveryError) {
        return apiFailure(
          'delivery_failed',
          error.noFallbackAvailable
            ? 'Unable to send OTP. WhatsApp is unavailable and no email is on file. Contact your school admin.'
            : 'Unable to send OTP right now. Please try again, or contact your school admin.',
          503,
        );
      }
      throw error;
    }

    return apiSuccess({
      success: true,
      channel,
      expiresIn: OTP_EXPIRY_MINUTES * 60,
      maskedContact:
        channel === 'whatsapp' ? maskPhone(phone) : maskEmail(user.email ?? ''),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
