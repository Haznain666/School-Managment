import { and, eq, gt, isNull } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { emergencyLoginTokens, schoolUsers, schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { mintSessionForEmail } from '@/lib/supabase-auth';
import { isUserRole } from '@/types/school-auth';

/**
 * GET /api/school/emergency-login/[token]
 *
 * Redeems a platform-issued emergency link and opens a session.
 * Unauthenticated: the link is the credential.
 *
 * The link is consumed on first success — `used_at` is stamped before the
 * session is minted, so a link that leaks after use is inert.
 *
 * ── No claims to refresh any more ────────────────────────────────────────
 * This route used to re-stamp the user's role and branch onto their Firebase
 * account at redemption, because claims issued minutes earlier could already
 * be stale. There is nothing to refresh now: role and branch are read from
 * `school_users` on every request, so redemption only has to establish *who*
 * this is. The membership checks below stay exactly as they were — they are
 * what makes a link for a since-deactivated account fail.
 *
 * The response no longer carries a credential; the cookie is set on it.
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
        email: schoolUsers.email,
        authUserId: schoolUsers.authUserId,
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

    // The account is reached by address now, not by a stored uid. A member who
    // never accepted their invitation has no address on file and therefore no
    // account to sign in as — the same condition the issuing route refuses on,
    // re-checked here because the row may have changed since.
    if (user.email === null || user.email === '') {
      return apiFailure(
        'no_account',
        'This member has no email address on file, so there is no account to open.',
        409,
      );
    }

    /*
     * An address is not an account.
     *
     * `auth_user_id` is null until somebody has actually been through password
     * setup, and a session minted for an address with nothing behind it is not
     * a session: the cookie is written, this route answers `ok`, and the very
     * next request bounces to the login page with no explanation anywhere.
     *
     * Found in Sprint 26 QA, where it cost an hour. A parent who had never
     * accepted their invitation was signed in "successfully" and then refused
     * by the parent portal, which looked exactly like a broken portal guard —
     * so the search went to the layout, the tenancy check and the cookie, and
     * the account itself was the last thing anybody looked at.
     *
     * Refused here rather than left to bounce, and named: the remedy is to send
     * the member their access email, which is a different button on a different
     * screen and nothing was pointing at it.
     */
    if (user.authUserId === null || user.authUserId === '') {
      return apiFailure(
        'no_account',
        'This member has never set a password, so there is no account to open yet. ' +
          'Send them their portal access first.',
        409,
      );
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

    // Writes the session cookie onto this response. Nothing is emailed — see
    // `mintSessionForEmail`.
    await mintSessionForEmail(user.email);

    return apiSuccess({ role: user.role, schoolSlug: school.slug });
  } catch (error) {
    return handleApiError(error);
  }
}
