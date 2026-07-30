import { and, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { schoolUsers } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { verifyIdToken } from '@/lib/firebase-admin';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import {
  createSchoolSession,
  schoolCookieOptions,
  sessionExpiryDays,
} from '@/lib/school-auth';
import { parseSchoolClaims } from '@/types/school-auth';

/**
 * POST /api/school/auth/session
 *
 * Trades a freshly minted Firebase ID token for an httpOnly session cookie.
 * Unauthenticated by definition — the ID token is the credential.
 *
 * The tenant check here is the one that stops cross-school sign-in: the token's
 * `locationId` claim must match the school whose subdomain the browser is on.
 * Correct credentials for School A cannot open a session on School B.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SessionBody {
  idToken?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<SessionBody>(request);
    const idToken = typeof body?.idToken === 'string' ? body.idToken : '';

    if (idToken === '') {
      return apiFailure('invalid_body', 'An ID token is required.', 400);
    }

    let claims: ReturnType<typeof parseSchoolClaims>;
    try {
      const decoded = await verifyIdToken(idToken);
      claims = parseSchoolClaims(decoded as unknown as Record<string, unknown>);
    } catch {
      return apiFailure('invalid_token', 'Sign-in could not be verified.', 401);
    }

    if (claims === null) {
      return apiFailure(
        'setup_incomplete',
        'Account setup incomplete. Use your invite link.',
        403,
      );
    }

    // The school this browser is on, resolved by middleware from the subdomain.
    const requestedLocationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (requestedLocationId === null || requestedLocationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    if (claims.locationId !== requestedLocationId) {
      return apiFailure(
        'wrong_school',
        'This account does not belong to this school.',
        403,
      );
    }

    // A deactivated member keeps valid credentials until their row says
    // otherwise, so the check has to happen here rather than in Firebase.
    const rows = await db
      .select({
        name: schoolUsers.name,
        isActive: schoolUsers.isActive,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.locationId, claims.locationId),
          eq(schoolUsers.firebaseUid, claims.uid),
        ),
      )
      .limit(1);

    const profile = rows[0];

    if (profile !== undefined && !profile.isActive) {
      return apiFailure(
        'account_disabled',
        'Your account has been deactivated. Contact your school admin.',
        403,
      );
    }

    const sessionCookie = await createSchoolSession(idToken);

    const response = apiSuccess({
      role: claims.role,
      name: profile?.name ?? '',
      locationId: claims.locationId,
    });

    response.cookies.set({
      ...schoolCookieOptions(sessionExpiryDays() * 24 * 60 * 60),
      value: sessionCookie,
    });

    return response as NextResponse;
  } catch (error) {
    return handleApiError(error);
  }
}
