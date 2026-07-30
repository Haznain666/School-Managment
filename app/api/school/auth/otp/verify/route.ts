import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { issueSchoolCustomToken } from '@/lib/firebase-custom-token';
import { verifyOTPSession } from '@/lib/otp';
import { InvalidPhoneError, normalizePhone } from '@/lib/phone';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { isUserRole } from '@/types/school-auth';

/**
 * POST /api/school/auth/otp/verify
 *
 * Checks a login passcode and, on success, returns a Firebase custom token.
 * The browser signs in with it and trades the resulting ID token for a session
 * cookie at `/api/school/auth/session`, which is where the tenant is checked
 * again.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VerifyBody {
  phone?: unknown;
  otp?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<VerifyBody>(request);
    const rawPhone = typeof body?.phone === 'string' ? body.phone : '';
    const otp = typeof body?.otp === 'string' ? body.otp.trim() : '';

    if (otp === '') {
      return apiFailure('invalid_body', 'Enter the code from WhatsApp.', 400);
    }

    let phone: string;
    try {
      phone = normalizePhone(rawPhone);
    } catch (error) {
      if (error instanceof InvalidPhoneError) {
        return apiFailure('invalid_phone', 'Enter a valid mobile number.', 400);
      }
      throw error;
    }

    const verdict = await verifyOTPSession(db, {
      locationId,
      phone,
      otp,
      purpose: 'login',
    });

    if (verdict === 'expired') {
      return apiFailure('otp_expired', 'OTP expired. Request a new one.', 410);
    }
    if (verdict === 'max_attempts') {
      return apiFailure('otp_max_attempts', 'Too many attempts. Request a new OTP.', 429);
    }
    if (verdict === 'invalid') {
      return apiFailure('otp_invalid', 'Incorrect OTP. Try again.', 401);
    }

    const userRows = await db
      .select({
        role: schoolUsers.role,
        branchId: schoolUsers.branchId,
        isActive: schoolUsers.isActive,
      })
      .from(schoolUsers)
      .where(and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.phone, phone)))
      .limit(1);

    const user = userRows[0];
    if (user === undefined || !user.isActive) {
      return apiFailure(
        'account_disabled',
        'Account deactivated. Contact your school admin.',
        403,
      );
    }

    if (!isUserRole(user.role)) {
      return apiFailure('invalid_role', 'Your account role is not recognised.', 409);
    }

    const schoolRows = await db
      .select({ slug: schools.slug })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    const { customToken } = await issueSchoolCustomToken(locationId, phone, {
      locationId,
      role: user.role,
      branchId: user.branchId,
      schoolSlug: school.slug,
    });

    return apiSuccess({ customToken, role: user.role });
  } catch (error) {
    return handleApiError(error);
  }
}
