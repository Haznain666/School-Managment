import 'server-only';

import { cache } from 'react';
import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

import { schoolUsers } from '@/db/schema';
import { parseSchoolClaims, type SchoolCustomClaims, type SchoolSessionClaims } from '@/types/school-auth';

import { db } from './drizzle';
import { getAdminAuth, verifyIdToken } from './firebase-admin';
import { serverEnv } from './env';

/**
 * Session-cookie lifecycle for the school portals.
 *
 * The browser is given an httpOnly session cookie rather than an ID token, for
 * two reasons: it cannot be read by scripts, and Firebase can revoke it
 * server-side — `verifySessionCookie(cookie, true)` checks revocation on every
 * call, so deactivating a user takes effect immediately rather than at token
 * expiry.
 */

export function sessionCookieName(): string {
  return serverEnv('SCHOOL_SESSION_COOKIE_NAME', 'school_session');
}

export function sessionExpiryDays(): number {
  const raw = Number.parseInt(serverEnv('SCHOOL_SESSION_EXPIRY_DAYS', '14'), 10);
  // Firebase caps session cookies at 14 days.
  return Number.isFinite(raw) && raw > 0 && raw <= 14 ? raw : 14;
}

export function sessionExpiryMs(): number {
  return sessionExpiryDays() * 24 * 60 * 60 * 1000;
}

/** Exchanges a freshly minted ID token for a session cookie. */
export async function createSchoolSession(idToken: string): Promise<string> {
  return getAdminAuth().createSessionCookie(idToken, {
    expiresIn: sessionExpiryMs(),
  });
}

/**
 * Is this account still allowed in?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Deactivating a member has to take effect *now*, not whenever their token
 * happens to expire. Under Firebase that came free: `verifySessionCookie(c,
 * true)` asks Firebase about revocation on every call. Supabase has no
 * equivalent — its access tokens stay valid until they expire (up to an hour)
 * even after `auth.admin.signOut(userId, 'global')`.
 *
 * So the property is moved into the application, where it does not depend on
 * the identity provider at all. It is checked here, at the one point every
 * layout and every API route already passes through, rather than being
 * scattered across call sites where one omission is a hole.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────
 * One indexed lookup per request, memoised for the request by `cache()` — the
 * same arrangement `lib/permission-queries.ts` uses, so a layout plus three
 * routes still costs one query.
 *
 * ── The absent-row case ──────────────────────────────────────────────────
 * A missing row is treated as active, deliberately. Deactivation is a soft
 * delete — `school_users.is_active` goes false and the row stays — so "no row"
 * never means "deactivated". It means a session with no school profile behind
 * it, which is what the Super Admin's "Login as Admin" hand-off produces. That
 * session is authorised by the platform operator's own credential and must not
 * be locked out by a table it was never in.
 */
const isAccountActive = cache(
  async (locationId: string, uid: string): Promise<boolean> => {
    const rows = await db
      .select({ isActive: schoolUsers.isActive })
      .from(schoolUsers)
      .where(
        and(eq(schoolUsers.locationId, locationId), eq(schoolUsers.firebaseUid, uid)),
      )
      .limit(1);

    const row = rows[0];
    return row === undefined || row.isActive;
  },
);

/**
 * Verifies a session cookie and returns its claims.
 * Returns null for anything that is not a currently valid session — expired,
 * revoked, malformed, missing the tenant claims, or belonging to an account
 * that has since been deactivated.
 */
export async function verifySchoolSession(
  cookie: string,
): Promise<SchoolSessionClaims | null> {
  let claims: SchoolSessionClaims | null;

  try {
    // `true` checks revocation at the identity provider. Kept while Firebase
    // is still the provider; the `is_active` check below is what carries the
    // guarantee across to Supabase, where no such check exists.
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    claims = parseSchoolClaims(decoded as unknown as Record<string, unknown>);
  } catch {
    return null;
  }

  if (claims === null) return null;

  // A valid, unexpired credential is not the same as a live account.
  if (!(await isAccountActive(claims.locationId, claims.uid))) return null;

  return claims;
}

/** Reads and verifies the session from the incoming request's cookies. */
export async function readSchoolSession(): Promise<SchoolSessionClaims | null> {
  const store = await cookies();
  const value = store.get(sessionCookieName())?.value;
  if (value === undefined || value === '') return null;
  return verifySchoolSession(value);
}

/**
 * Writes the tenant claims onto a Firebase user.
 * The user must obtain a fresh ID token before the claims appear; existing
 * tokens keep the old values until they expire.
 */
export async function setSchoolUserClaims(
  uid: string,
  claims: SchoolCustomClaims,
): Promise<void> {
  await getAdminAuth().setCustomUserClaims(uid, {
    locationId: claims.locationId,
    role: claims.role,
    branchId: claims.branchId,
    schoolSlug: claims.schoolSlug,
  });
}

/**
 * Invalidates every outstanding session for a user. Call this whenever their
 * role, branch or active status changes, so stale claims cannot be replayed.
 */
export async function revokeSchoolSession(uid: string): Promise<void> {
  await getAdminAuth().revokeRefreshTokens(uid);
}

/** Verifies an ID token and returns its school claims, or null. */
export async function claimsFromIdToken(
  idToken: string,
): Promise<SchoolSessionClaims | null> {
  try {
    const decoded = await verifyIdToken(idToken);
    return parseSchoolClaims(decoded as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Cookie attributes shared by the session and logout routes. */
export function schoolCookieOptions(maxAgeSeconds: number) {
  return {
    name: sessionCookieName(),
    httpOnly: true,
    sameSite: 'lax' as const,
    // Secure everywhere except local http development.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
