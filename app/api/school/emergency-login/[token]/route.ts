import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { emergencyLoginTokens, schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getAdminAuth } from '@/lib/firebase-admin';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { isUserRole } from '@/types/school-auth';

/**
 * GET /api/school/emergency-login/[token]
 *
 * Redeems a platform-issued emergency link and returns a Firebase custom
 * token. Unauthenticated: the link is the credential.
 *
 * The link is consumed on first success — `used_at` is stamped before the
 * response is returned, so a link that leaks after use is inert. Claims are
 * refreshed at redemption rather than trusted from issue time, in case the
 * user's role or branch changed in the intervening minutes.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ token: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const rows = await db
      .select()
      .from(emergencyLoginTokens)
      .where(
        and(
          eq(emergencyLoginTokens.token, token),
          isNull(emergencyLoginTokens.usedAt),
          gt(emergencyLoginTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    const record = rows[0];

    // One message for every failure: unknown, expired and already-used are not
    // distinguished, so a leaked link reveals nothing about its state.
    if (record === undefined || record.locationId !== locationId) {
      return apiFailure('invalid_token', 'Invalid or expired emergency link', 404);
    }

    const userRows = await db
      .select({
        role: schoolUsers.role,
        branchId: schoolUsers.branchId,
        isActive: schoolUsers.isActive,
      })
      .from(schoolUsers)
      .where(
        and(
          eq(schoolUsers.id, record.schoolUserId),
          eq(schoolUsers.locationId, record.locationId),
        ),
      )
      .limit(1);

    const user = userRows[0];
    if (user === undefined || !user.isActive) {
      return apiFailure(
        'account_disabled',
        'This account is not active. Contact your platform administrator.',
        403,
      );
    }

    if (!isUserRole(user.role)) {
      return apiFailure('invalid_role', 'This account role is not recognised.', 409);
    }

    const schoolRows = await db
      .select({ slug: schools.slug })
      .from(schools)
      .where(eq(schools.locationId, record.locationId))
      .limit(1);

    const school = schoolRows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    // Consume before issuing: if the update fails, no token is handed out.
    const consumed = await db
      .update(emergencyLoginTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(emergencyLoginTokens.id, record.id),
          // Re-checking the null guards makes concurrent redemption safe: only
          // one request can win the update, so only one gets a token.
          isNull(emergencyLoginTokens.usedAt),
        ),
      )
      .returning({ id: emergencyLoginTokens.id });

    if (consumed[0] === undefined) {
      return apiFailure('invalid_token', 'Invalid or expired emergency link', 404);
    }

    const auth = getAdminAuth();

    await auth.setCustomUserClaims(record.firebaseUid, {
      locationId: record.locationId,
      role: user.role,
      branchId: user.branchId,
      schoolSlug: school.slug,
    });

    const customToken = await auth.createCustomToken(record.firebaseUid);

    return apiSuccess({ customToken, role: user.role });
  } catch (error) {
    return handleApiError(error);
  }
}
