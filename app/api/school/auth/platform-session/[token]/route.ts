import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { platformAdminEmailFor, verifyHandoffToken } from '@/lib/platform-school-access';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import {
  getAuthAdmin,
  getOrCreateAuthUser,
  mintSessionForEmail,
  SupabaseAuthError,
} from '@/lib/supabase-auth';

/**
 * POST /api/school/auth/platform-session/[token]
 *
 * Redeems a Super Admin hand-off and opens a school_admin session for one
 * school.
 *
 * Unauthenticated by definition — the signed token is the credential, exactly
 * as the emergency link is. What it is *not* is unguarded: the token is signed
 * with the platform's own secret, expires in two minutes, and names the one
 * location it may open. The location is then checked against the school this
 * request actually arrived at, so a token minted for School A cannot open
 * School B even if it is replayed at B's address.
 *
 * ── The browser round trip is gone ───────────────────────────────────────
 * This route used to return a Firebase custom token for the browser to sign in
 * with. GoTrue lets the server mint the session itself, so the response now
 * carries no credential at all — just the cookie, already set.
 *
 * ── The one place claims still live in the token ─────────────────────────
 * Everyone else's role comes from `school_users`. The operator has no row
 * there and must not have one: they are not a member of the school, and a row
 * would appear in the school's own user list. So the marker goes in
 * `app_metadata`, which only the service-role key can write, and
 * `lib/school-auth.ts` reads it only when no membership row exists.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { token } = await context.params;

    // The school this browser is on, resolved by middleware from the subdomain
    // (or `?school=` on a deployment host).
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const claims = await verifyHandoffToken(token);

    // One message for both failures: an expired link and a link for another
    // school are not distinguished, so a leaked URL reveals nothing.
    if (claims === null || claims.locationId !== locationId) {
      return apiFailure(
        'invalid_token',
        'This sign-in link is invalid or has expired.',
        401,
      );
    }

    const rows = await db
      .select({ slug: schools.slug, isActive: schools.isActive })
      .from(schools)
      .where(eq(schools.locationId, locationId))
      .limit(1);

    const school = rows[0];
    if (school === undefined) {
      return apiFailure('no_school', 'This school portal is unavailable.', 404);
    }

    // Re-checked at redemption rather than trusted from issue time: the tenant
    // may have been deactivated in the intervening minutes.
    if (!school.isActive) {
      return apiFailure('school_inactive', 'This school portal is closed.', 403);
    }

    const address = platformAdminEmailFor(locationId);

    // ── On this try/catch ──────────────────────────────────────────────────
    // Everything below is Supabase, and Supabase fails for reasons that have
    // nothing to do with the link the operator clicked: a wrong service-role
    // key, an unreachable project, email sign-in disabled. Letting those fall
    // through to `handleApiError` reported them as the same anonymous
    // "Something went wrong" as a bad token, which sent debugging in exactly
    // the wrong direction. They get their own code, and the real cause goes to
    // the server log where an operator can read it.
    let step = 'get-or-create-user';

    try {
      const user = await getOrCreateAuthUser(address, {
        platformAdmin: true,
        platformLocationId: locationId,
      });

      // Rewritten on every hand-off rather than only at creation, so the
      // recorded operator is the one who actually entered this time.
      step = 'set-app-metadata';
      const { error } = await getAuthAdmin().auth.admin.updateUserById(user.id, {
        app_metadata: {
          platformAdmin: true,
          platformLocationId: locationId,
          platformAdminEmail: claims.email,
        },
      });

      if (error !== null) {
        throw new SupabaseAuthError('metadata_failed', error.message);
      }

      // Writes the session cookie. Nothing is emailed; see `mintSessionForEmail`.
      step = 'mint-session';
      await mintSessionForEmail(address);

      console.info(
        `[platform-login] ${claims.email} entered school ${locationId} as school_admin`,
      );

      return apiSuccess({ schoolSlug: school.slug });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);

      console.error(
        `[platform-login] Supabase ${step} failed for location ${locationId}:`,
        error,
      );

      // ── On returning the detail to the browser ────────────────────────────
      // Nothing reaches this line without a hand-off token signed by the
      // platform's own secret, so the only caller who can see this is the
      // operator. Withholding the reason from them buys no security and costs
      // a round trip through the server logs — which is exactly what the first
      // version of this cost.
      return apiFailure(
        'auth_unavailable',
        `Supabase rejected the request at step "${step}": ${detail.slice(0, 300)}`,
        503,
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
