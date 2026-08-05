import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import {
  buildGhlAuthorizeUrl,
  createOAuthState,
  encodeOAuthState,
  oauthStateCookieOptions,
  GHL_OAUTH_STATE_TTL_SECONDS,
} from '@/lib/ghl-oauth';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * GET /api/super-admin/schools/[schoolId]/ghl/connect
 *
 * Starts the GoHighLevel install for one school: mints a state nonce, remembers
 * it in an httpOnly cookie alongside the school it belongs to, and redirects
 * the operator to GHL's consent screen.
 *
 * A redirect rather than a JSON endpoint because the browser has to leave for
 * marketplace.gohighlevel.com, and a `fetch` cannot take it there.
 *
 * The school id is *not* trusted from the callback later — it travels in the
 * cookie, which the browser will only return to us. The `state` parameter
 * carries the nonce alone, so a tampered state cannot redirect an install onto
 * a different school.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    await requireSuperAdmin();

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const rows = await db
      .select({ locationId: schools.locationId })
      .from(schools)
      .where(eq(schools.id, schoolId))
      .limit(1);

    const school = rows[0];
    if (school === undefined) {
      return apiFailure('not_found', 'School not found.', 404);
    }

    const state = createOAuthState(schoolId, school.locationId);
    const response = NextResponse.redirect(buildGhlAuthorizeUrl(state.nonce));

    response.cookies.set({
      ...oauthStateCookieOptions(GHL_OAUTH_STATE_TTL_SECONDS),
      value: encodeOAuthState(state),
    });

    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
