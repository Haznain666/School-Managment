import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import {
  checkThrottle,
  clientIpHash,
  recordAttempt,
  throttledResponse,
} from '@/lib/auth-throttle';
import { SCHOOL_LOCATION_HEADER } from '@/lib/school-context';
import { schoolSessionFor } from '@/lib/school-auth';
import { signInWithPassword, signOutCurrentSession } from '@/lib/supabase-auth';
import { homeRouteForRole } from '@/types/school-auth';

/**
 * POST /api/school/auth/login — email + password.
 *
 * Unauthenticated by definition: the password is the credential.
 *
 * ── One request, one cookie ──────────────────────────────────────────────
 * The Firebase arrangement took three hops: the server minted a custom token,
 * the browser signed in with it to get an ID token, and POSTed that back to
 * `/api/school/auth/session` to be traded for a cookie. GoTrue verifies the
 * password itself, so the whole round trip is gone along with that route, and
 * so is the Firebase client SDK.
 *
 * ── The tenant check is what stops cross-school sign-in ──────────────────
 * A correct password proves who someone is, never where they belong. The
 * session is minted first and the membership checked second, against the
 * school whose subdomain this request arrived at — and a caller with no
 * membership here is signed straight back out rather than left holding a
 * usable cookie for a school they are not in.
 *
 * ── Throttling, and why it is checked before anything is looked up ───────
 * Five failures against one address in fifteen minutes and that address is
 * refused for fifteen minutes; a much looser second limit applies per origin,
 * for the spray that never reaches five against any single account. See
 * `lib/auth-throttle.ts`.
 *
 * The check runs before `signInWithPassword` and before any database read, so
 * a throttled answer costs the same and says the same thing for an address that
 * exists and one that does not. That is the same reason the three failure cases
 * below share one message, and it is undone the moment anything here consults
 * `school_users` first.
 *
 * Both outcomes are recorded, because a success is what clears the streak —
 * otherwise four typos followed by a correct sign-in would leave someone one
 * mistake from a lockout for the rest of the window.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  email?: unknown;
  password?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const locationId = request.headers.get(SCHOOL_LOCATION_HEADER);
    if (locationId === null || locationId === '') {
      return apiFailure('no_school', 'No school resolved for this address.', 400);
    }

    const body = await readJsonBody<LoginBody>(request);
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (email === '' || password === '') {
      return apiFailure('invalid_body', 'Enter your email address and password.', 400);
    }

    const ipHash = clientIpHash(request);
    const throttle = await checkThrottle('login', email, ipHash);
    if (!throttle.allowed) return throttledResponse(throttle);

    const user = await signInWithPassword(email, password);

    // ── On the single message ────────────────────────────────────────────
    // Wrong password, unknown address and not-a-member-here all answer the
    // same way. Telling them apart would let anyone with the login page
    // enumerate a school's staff one address at a time.
    if (user === null) {
      await recordAttempt('login', email, ipHash, false);
      return apiFailure('invalid_credentials', 'Incorrect email address or password.', 401);
    }

    const claims = await schoolSessionFor(user, locationId);

    if (claims === null) {
      // A real account, but not one that may open *this* school — the wrong
      // subdomain, a deactivated membership, or a closed school. The cookie
      // GoTrue just wrote has to go, or it would still authenticate them.
      await signOutCurrentSession();
      // Counted as a failure, and it is one: the password was right but this is
      // not their school. Counting it also keeps a valid password from being an
      // unlimited oracle for "which schools is this person a member of".
      await recordAttempt('login', email, ipHash, false);
      return apiFailure('invalid_credentials', 'Incorrect email address or password.', 401);
    }

    await recordAttempt('login', email, ipHash, true);

    return apiSuccess({
      role: claims.role,
      redirectTo: homeRouteForRole(claims.role),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
