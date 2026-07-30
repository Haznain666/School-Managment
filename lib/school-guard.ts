import 'server-only';

import { redirect } from 'next/navigation';

import {
  ROLE_HOME_ROUTES,
  type SchoolSessionClaims,
  type UserRole,
} from '@/types/school-auth';

import { getSchoolHeaders } from './school-tenant';
import { readSchoolSession } from './school-auth';

/**
 * Layout-level authorisation for the school portals.
 *
 * This is where a session is actually verified. Middleware only checks that a
 * cookie exists — it runs on the Edge and cannot call `firebase-admin` — so
 * every protected layout must call this before rendering anything.
 *
 * Three things are enforced here:
 *   1. the session verifies and has not been revoked
 *   2. its tenant matches the school this hostname resolves to
 *   3. the caller's role is allowed on this route, otherwise they are sent to
 *      their own home route rather than shown someone else's portal
 */

export interface GuardResult {
  claims: SchoolSessionClaims;
  locationId: string;
}

function loginRedirect(slug: string | null): never {
  // Preserve the dev `?school=` parameter so the login page can still resolve
  // its tenant after the bounce.
  redirect(slug === null || slug === '' ? '/login' : `/login?school=${encodeURIComponent(slug)}`);
}

/**
 * Verifies the session and the caller's role.
 * Redirects instead of returning when access is refused.
 */
export async function requireSchoolRole(
  allowedRoles: readonly UserRole[],
): Promise<GuardResult> {
  const { locationId, slug } = await getSchoolHeaders();

  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  const claims = await readSchoolSession();
  if (claims === null) {
    loginRedirect(slug);
  }

  // A session minted for another school must not open this one, even though
  // both live in the same Firebase project.
  if (claims.locationId !== locationId) {
    loginRedirect(slug);
  }

  if (!allowedRoles.includes(claims.role)) {
    redirect(ROLE_HOME_ROUTES[claims.role]);
  }

  return { claims, locationId };
}
