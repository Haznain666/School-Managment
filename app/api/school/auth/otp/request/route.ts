import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { findOrCreateContact, sendWhatsAppMessage } from '@/lib/ghl-client';
import { createOTPSession, OTP_EXPIRY_MINUTES } from '@/lib/otp';
import { InvalidPhoneError, maskPhone, normalizePhone } from '@/lib/phone';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';

/**
 * POST /api/school/auth/otp/request
 *
 * Sends a login passcode to a registered number over WhatsApp.
 * Unauthenticated by necessity — it runs before anyone is signed in.
 *
 * The passcode is never returned in the response and never logged: possession
 * of the handset is the whole proof, so anything that reveals the code
 * elsewhere defeats the mechanism.
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
      .select({ name: schoolUsers.name, isActive: schoolUsers.isActive })
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

    const { contactId } = await findOrCreateContact(db, locationId, {
      phone,
      name: user.name,
    });

    await sendWhatsAppMessage(
      db,
      locationId,
      contactId,
      `Your login OTP for ${school.name} is: ${otp}\n\n` +
        `Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share this code.`,
    );

    return apiSuccess({
      success: true,
      expiresIn: OTP_EXPIRY_MINUTES * 60,
      maskedPhone: maskPhone(phone),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
