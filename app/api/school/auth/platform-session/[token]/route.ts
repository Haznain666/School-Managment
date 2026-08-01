import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';

import { schools } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getAdminAuth } from '@/lib/firebase-admin';
import { derivePlatformAdminUid, verifyHandoffToken } from '@/lib/platform-school-access';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';

/**
 * POST /api/school/auth/platform-session/[token]
 *
 * Redeems a Super Admin hand-off and returns a Firebase custom token carrying
 * school_admin claims for one school.
 *
 * Unauthenticated by definition — the signed token is the credential, exactly
 * as the emergency link is. What it is *not* is unguarded: the token is signed
 * with the platform's own secret, expires in two minutes, and names the one
 * location it may open. The location is then checked against the school this
 * request actually arrived at, so a token minted for School A cannot open
 * School B even if it is replayed at B's address.
 *
 * This route is deliberately separate from the OTP flow rather than a branch
 * inside it: school members keep passcode sign-in untouched, and the two paths
 * cannot be confused for one another in a later edit.
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

    const uid = derivePlatformAdminUid(locationId);

    // ── On this try/catch ──────────────────────────────────────────────────
    // Everything below is Firebase, and Firebase fails for reasons that have
    // nothing to do with the link the operator clicked: a malformed service
    // account, a revoked key, an unreachable Identity Platform. Letting those
    // fall through to `handleApiError` reported them as the same anonymous
    // "Something went wrong" as a bad token, which sent debugging in exactly
    // the wrong direction. They get their own code now, and the real cause goes
    // to the server log where an operator can read it.
    // Names the sub-step in flight, so the failure below can say which one
    // broke rather than "Firebase, somewhere".
    let firebaseStep = 'admin-init';

    try {
      const auth = getAdminAuth();

      // The account is created on first hand-off and reused after that. It has
      // no email and no password of its own — it is reachable only by a token
      // signed with the platform secret, which is why nothing here is a
      // credential a school member could ever present.
      firebaseStep = 'get-or-create-user';
      try {
        await auth.getUser(uid);
      } catch (error) {
        if ((error as { code?: unknown }).code !== 'auth/user-not-found') throw error;

        try {
          await auth.createUser({ uid, displayName: 'Platform Super Admin' });
        } catch (createError) {
          // A concurrent hand-off may have created it in the gap above.
          if ((createError as { code?: unknown }).code !== 'auth/uid-already-exists') {
            throw createError;
          }
        }
      }

      // Claims are written before the token is minted, so the ID token the
      // client obtains already carries the tenant and the role.
      firebaseStep = 'set-custom-claims';
      await auth.setCustomUserClaims(uid, {
        locationId,
        role: 'school_admin',
        // Platform access is school-wide; it is never scoped to one campus.
        branchId: null,
        schoolSlug: school.slug,
        // What makes this session say so on screen. It grants nothing extra —
        // `role` above is the whole of the authorisation.
        platformAdmin: true,
        platformAdminEmail: claims.email,
      });

      firebaseStep = 'create-custom-token';
      const customToken = await auth.createCustomToken(uid);

      console.info(
        `[platform-login] ${claims.email} entered school ${locationId} as school_admin`,
      );

      return apiSuccess({ customToken, schoolSlug: school.slug });
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const message = error instanceof Error ? error.message : String(error);

      console.error(
        `[platform-login] Firebase ${firebaseStep} failed for location ${locationId}:`,
        typeof code === 'string' ? code : '',
        error,
      );

      // ── On returning the detail to the browser ────────────────────────────
      // Nothing reaches this line without a hand-off token signed by the
      // platform's own secret, so the only caller who can see this is the
      // operator. Withholding the reason from them buys no security and costs a
      // round trip through the server logs — which is exactly what the first
      // version of this cost.
      //
      // Truncated because a stack-laden message is no more useful than its
      // first line, and the codes and configuration messages we care about
      // ("not valid base64-encoded JSON", "auth/invalid-credential") are short.
      const detail = typeof code === 'string' && code !== '' ? code : message;

      return apiFailure(
        'firebase_unavailable',
        `Firebase rejected the request at step "${firebaseStep}": ${detail.slice(0, 300)}`,
        503,
      );
    }
  } catch (error) {
    return handleApiError(error);
  }
}
