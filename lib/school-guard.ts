import 'server-only';

import { redirect } from 'next/navigation';

import { ROLE_HOME_ROUTES, type SchoolSessionClaims, type UserRole } from '@/types/school-auth';

import { hasPermission, permissionsForRole } from './permission-queries';
import type { Permission } from './permissions';
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

/**
 * The permission-shaped counterpart of `requireSchoolRole`.
 *
 * Same three checks — session verifies, tenant matches, caller is allowed —
 * except the third asks the school's own matrix rather than a fixed list. A
 * caller without the permission is redirected to their own home route rather
 * than shown a wall, for the same reason `requireSchoolRole` does it: a
 * coordinator who follows a stale bookmark to the payroll screen should land
 * somewhere useful, not on an error.
 *
 * Returns the caller's full permission set alongside the claims, so a page can
 * decide what to render without a second round trip — the underlying read is
 * request-cached, but asking once and passing it down is clearer than five
 * scattered `hasPermission` calls in one tree.
 */
export async function requireSchoolPermission(
  permission: Permission,
): Promise<GuardResult & { permissions: Permission[] }> {
  const { locationId, slug } = await getSchoolHeaders();

  if (locationId === null || locationId === '') {
    redirect('/school-not-found');
  }

  const claims = await readSchoolSession();
  if (claims === null) {
    loginRedirect(slug);
  }

  if (claims.locationId !== locationId) {
    loginRedirect(slug);
  }

  const permissions = await permissionsForRole(locationId, claims.role);

  if (!permissions.includes(permission)) {
    redirect(ROLE_HOME_ROUTES[claims.role]);
  }

  return { claims, locationId, permissions };
}

/**
 * Whether the signed-in caller holds a permission, without redirecting.
 *
 * For deciding whether to render a button, not whether to serve a page. A
 * caller with no session at all gets `false` rather than a redirect, because
 * that case is already handled by whichever guard let the page render.
 */
export async function callerHasPermission(permission: Permission): Promise<boolean> {
  const claims = await readSchoolSession();
  if (claims === null) return false;

  return hasPermission(claims.locationId, claims.role, permission);
}
