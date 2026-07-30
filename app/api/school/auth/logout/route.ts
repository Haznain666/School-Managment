import { NextResponse, type NextRequest } from 'next/server';

import { apiSuccess, handleApiError } from '@/lib/api-response';
import {
  revokeSchoolSession,
  schoolCookieOptions,
  sessionCookieName,
  verifySchoolSession,
} from '@/lib/school-auth';

/**
 * POST /api/school/auth/logout
 *
 * Revokes every refresh token for the user, then clears the cookie. Revoking
 * matters: without it the session cookie would keep verifying on other devices
 * until it expired on its own.
 *
 * Signing out while already signed out is not an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(sessionCookieName())?.value;

    if (cookie !== undefined && cookie !== '') {
      const claims = await verifySchoolSession(cookie);
      if (claims !== null) {
        try {
          await revokeSchoolSession(claims.uid);
        } catch (error) {
          // Clearing the cookie still signs this browser out.
          console.error('[logout] could not revoke refresh tokens:', error);
        }
      }
    }

    const response = apiSuccess({ success: true });
    response.cookies.set({ ...schoolCookieOptions(0), value: '' });
    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
