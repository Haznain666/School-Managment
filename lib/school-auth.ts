import 'server-only';

import { cookies } from 'next/headers';

import { parseSchoolClaims, type SchoolCustomClaims, type SchoolSessionClaims } from '@/types/school-auth';

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
 * Verifies a session cookie and returns its claims.
 * Returns null for anything that is not a currently valid session — expired,
 * revoked, malformed, or missing the tenant claims.
 */
export async function verifySchoolSession(
  cookie: string,
): Promise<SchoolSessionClaims | null> {
  try {
    // `true` checks revocation, so a deactivated user is rejected at once.
    const decoded = await getAdminAuth().verifySessionCookie(cookie, true);
    return parseSchoolClaims(decoded as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
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
