import 'server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import type { User } from '@supabase/supabase-js';

import { schoolUsers, schools } from '@/db/schema';
import { isUserRole, type SchoolSessionClaims } from '@/types/school-auth';

import { db } from './drizzle';
import { SCHOOL_LOCATION_HEADER } from './school-context';
import {
  getAuthenticatedUser,
  revokeAllSessions,
  sessionCookieName,
  sessionCookieOptions,
  signOutCurrentSession,
} from './supabase-auth';

/**
 * Session → claims for the school portals.
 *
 * ── What changed at Stage 4, and why it is smaller than it looks ─────────
 * Under Firebase the claim set was minted at sign-in, stamped into the token as
 * custom claims, and carried in the cookie. Under Supabase the cookie carries
 * only *who you are*. Everything about *what you may do here* is read from
 * `school_users` on the request that needs it.
 *
 * That is not a workaround for a missing Supabase feature — `app_metadata`
 * would have held claims perfectly well. It is the better arrangement, and
 * STATE.md §3 asked for it:
 *
 *   · One person, one account. The same address can be a teacher at one school
 *     and a parent at another; a globally-unique `auth.users.email` cannot
 *     express that, but two `school_users` rows can. See `lib/supabase-auth.ts`.
 *   · A role change takes effect on the next request. Firebase's custom claims
 *     went stale until the token expired, and STATE.md §4.3 carried that
 *     hazard forward to Supabase. It no longer applies: there are no role
 *     claims in the token to be stale.
 *   · Deactivation was already read per-request (`isAccountActive`, below).
 *     Folding the rest of the row into the same query makes it free.
 *
 * The tenant comes from the subdomain, which middleware resolved and stamped
 * on the request. It has never come from user input and still does not.
 */

export { sessionCookieName, sessionCookieOptions };

export function sessionExpiryDays(): number {
  // Retained for the invitation and hand-off copy that quotes a validity
  // period. GoTrue owns the real refresh-token lifetime, configured in the
  // Supabase dashboard rather than here.
  return 14;
}

/**
 * The school this request arrived at.
 *
 * Read from the middleware header rather than from the session, which is the
 * whole point: the credential says who, the address says where. A valid
 * account for School A presenting itself at School B's subdomain finds no
 * membership row and is refused.
 */
async function requestLocationId(): Promise<string | null> {
  const store = await headers();
  const value = store.get(SCHOOL_LOCATION_HEADER);
  return value === null || value === '' ? null : value;
}

/**
 * Is this account still allowed in?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Deactivating a member has to take effect *now*, not whenever their token
 * happens to expire. Under Firebase that came free: `verifySessionCookie(c,
 * true)` asked Firebase about revocation on every call. Supabase has no
 * equivalent — its access tokens stay valid until they expire (up to an hour)
 * even after `auth.admin.signOut(userId, 'global')`.
 *
 * So the property lives in the application, where it does not depend on the
 * identity provider at all. It is checked here, at the one point every layout
 * and every API route already passes through, rather than being scattered
 * across call sites where one omission is a hole.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * One indexed lookup per request, memoised for the request by `cache()` — the
 * same arrangement `lib/permission-queries.ts` uses, so a layout plus three
 * routes still costs one query. It now returns the whole membership rather
 * than a boolean, because the role and branch were going to be read anyway.
 *
 * ── The absent-row case changed ──────────────────────────────────────────
 * A missing row used to be treated as *active*. That was never about ordinary
 * members: deactivation is a soft delete, so "no row" could not mean
 * "deactivated". It meant the Super Admin's "Login as Admin" hand-off, which
 * produces a session with no school profile behind it and must not be locked
 * out by a table it was never in.
 *
 * That case is now handled explicitly and earlier, from `app_metadata` in
 * `resolveClaims` below. So a missing row here means what it appears to mean —
 * this account is not a member of this school — and is refused. Fail-closed,
 * which is what it should have been all along; it simply could not be while
 * the operator session was indistinguishable from an absence.
 */
const membershipFor = cache(
  async (locationId: string, authUserId: string) => {
    const rows = await db
      .select({
        role: schoolUsers.role,
        branchId: schoolUsers.branchId,
        isActive: schoolUsers.isActive,
        slug: schools.slug,
        schoolIsActive: schools.isActive,
      })
      .from(schoolUsers)
      .innerJoin(schools, eq(schools.locationId, schoolUsers.locationId))
      .where(
        and(
          eq(schoolUsers.locationId, locationId),
          eq(schoolUsers.authUserId, authUserId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  },
);

/** The school's slug, for the platform-operator path that has no membership row. */
const slugForLocation = cache(async (locationId: string): Promise<string | null> => {
  const rows = await db
    .select({ slug: schools.slug, isActive: schools.isActive })
    .from(schools)
    .where(eq(schools.locationId, locationId))
    .limit(1);

  const row = rows[0];
  return row === undefined || !row.isActive ? null : row.slug;
});

/**
 * The platform operator's marker, the one thing still carried in the token.
 *
 * `app_metadata` is writable only with the service-role key, so a school member
 * cannot set it on themselves — which is what makes it trustworthy here. It is
 * bound to a single location for the same reason the hand-off token is: an
 * operator account minted for School A must not open School B.
 */
function platformClaimsFor(
  user: User,
  locationId: string,
  schoolSlug: string,
): SchoolSessionClaims | null {
  const metadata = user.app_metadata as Record<string, unknown>;

  if (metadata['platformAdmin'] !== true) return null;
  if (metadata['platformLocationId'] !== locationId) return null;

  const email = metadata['platformAdminEmail'];

  return {
    uid: user.id,
    locationId,
    // Platform access is school-wide; it is never scoped to one campus.
    role: 'school_admin',
    branchId: null,
    schoolSlug,
    isPlatformAdmin: true,
    platformAdminEmail: typeof email === 'string' && email !== '' ? email : null,
  };
}

/**
 * Turns an authenticated Supabase user into claims for one school, or null.
 *
 * Null means "not authorised here" in every case — not a member, deactivated,
 * the school itself is closed, or the stored role is one this build does not
 * recognise. Callers must treat it as a refusal, never as "no tenant".
 */
async function resolveClaims(
  user: User,
  locationId: string,
): Promise<SchoolSessionClaims | null> {
  const membership = await membershipFor(locationId, user.id);

  if (membership === null) {
    // No membership row. Either the platform operator, or nobody.
    const slug = await slugForLocation(locationId);
    return slug === null ? null : platformClaimsFor(user, locationId, slug);
  }

  // A valid, unexpired credential is not the same as a live account.
  if (!membership.isActive || !membership.schoolIsActive) return null;

  // A role removed from USER_ROLES between deployments must not sign in with
  // an unrecognised one; `parseSchoolClaims` refused these and so does this.
  if (!isUserRole(membership.role)) return null;

  return {
    uid: user.id,
    locationId,
    role: membership.role,
    branchId: membership.branchId,
    schoolSlug: membership.slug,
    isPlatformAdmin: false,
    platformAdminEmail: null,
  };
}

/**
 * The current session's claims, or null.
 *
 * Memoised per request: a layout, its page and three route handlers verifying
 * the same session cost one `getUser()` and one membership query between them.
 */
export const readSchoolSession = cache(
  async (): Promise<SchoolSessionClaims | null> => {
    const locationId = await requestLocationId();
    if (locationId === null) return null;

    const user = await getAuthenticatedUser();
    if (user === null) return null;

    return resolveClaims(user, locationId);
  },
);

/**
 * Claims for an explicitly named school, for the routes that must not trust the
 * ambient header — the sign-in routes, which check the account against the
 * school the browser is actually on before writing anything.
 */
export async function schoolSessionFor(
  user: User,
  locationId: string,
): Promise<SchoolSessionClaims | null> {
  return resolveClaims(user, locationId);
}

/** Ends the session on this device and, best-effort, on every other one. */
export async function endSchoolSession(authUserId: string | null): Promise<void> {
  if (authUserId !== null) {
    try {
      await revokeAllSessions(authUserId);
    } catch (error) {
      // Clearing this browser's cookie still signs this browser out.
      console.error('[logout] could not revoke refresh tokens:', error);
    }
  }

  await signOutCurrentSession();
}

/**
 * Invalidates every outstanding session for a user.
 *
 * Call it when a role or branch changes. Under Firebase this was mandatory —
 * the claims were in the token and would otherwise be replayed until expiry.
 * It is now belt-and-braces: claims are read per request, so the change has
 * already taken effect. Still worth doing when someone is deactivated, so
 * their refresh tokens stop working too.
 */
export async function revokeSchoolSession(authUserId: string): Promise<void> {
  await revokeAllSessions(authUserId);
}
