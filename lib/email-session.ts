import 'server-only';

import { createHash } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { NextResponse } from 'next/server';

import { schoolUsers, schools } from '@/db/schema';
import { homeRouteForRole, isUserRole, type UserRole } from '@/types/school-auth';

import { db } from './drizzle';
import { publicEnv, serverEnv } from './env';
import { getAdminAuth } from './firebase-admin';
import {
  createSchoolSession,
  schoolCookieOptions,
  sessionExpiryDays,
} from './school-auth';

/**
 * Turning a verified email credential into a signed-in session.
 *
 * The WhatsApp flow hands the browser a Firebase custom token and lets it do
 * the last two hops itself (sign in, then trade the ID token for a cookie at
 * `/api/school/auth/session`). The email routes finish the job server-side
 * instead: they mint the custom token, exchange it for an ID token over the
 * Identity Toolkit REST API, create the session cookie, and set it on the
 * response. One request in, one cookie out.
 *
 * That matters most on the reset and set-password screens, where the previous
 * arrangement would have meant handing a fresh credential back to a page that
 * has just been told the old one is gone.
 *
 * Nothing about the cookie itself changes — same name, same httpOnly/secure
 * attributes, same Firebase revocation check on every read (`lib/school-auth.ts`).
 */

export class EmailSessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'EmailSessionError';
    this.code = code;
  }
}

/**
 * The Firebase uid for a school + email pair.
 *
 * Derived rather than random, for the same reason `deriveSchoolUid` is: a
 * resent invitation, a retried request or a second sign-in all have to land on
 * the same account instead of quietly creating a second one for the same
 * person.
 *
 * The school is part of the digest on purpose. One address may belong to a
 * teacher at one school and a parent at another, and those are two accounts
 * with two passwords and two sets of claims — Firebase's own globally unique
 * `email` field cannot express that, which is why these accounts carry a uid
 * and no email.
 */
export function deriveEmailUid(locationId: string, email: string): string {
  const digest = createHash('sha256')
    .update(`${locationId}:email:${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 24);

  return `eu_${digest}`;
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'auth/user-not-found'
  );
}

function isAlreadyExists(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null
      ? (error as { code?: unknown }).code
      : undefined;

  return code === 'auth/uid-already-exists' || code === 'auth/email-already-exists';
}

/**
 * Returns the Firebase uid for this school + email, creating the account when
 * it is absent.
 *
 * The address is attached to the Firebase record when it is free, because it
 * makes the account legible in the Firebase console. When it is already taken —
 * the same person at a second school — the account is created without it. That
 * costs nothing: this application verifies the password itself against
 * `user_passwords` and Firebase only ever sees a custom token.
 */
export async function getOrCreateEmailFirebaseUser(
  locationId: string,
  email: string,
): Promise<string> {
  const uid = deriveEmailUid(locationId, email);
  const auth = getAdminAuth();

  try {
    await auth.getUser(uid);
    return uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  try {
    await auth.createUser({ uid, email, emailVerified: true });
    return uid;
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }

  // Either a concurrent request won the race, or the address belongs to this
  // person's account at another school. Both are fine; the uid is ours.
  try {
    await auth.getUser(uid);
    return uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  await auth.createUser({ uid });
  return uid;
}

/** The Firebase Web API key, needed for the custom-token exchange below. */
function webApiKey(): string {
  const key = serverEnv('FIREBASE_WEB_API_KEY', publicEnv.firebase.apiKey);
  if (key === '') {
    throw new EmailSessionError(
      'server_misconfigured',
      'Firebase is not configured for sign-in on this deployment.',
    );
  }
  return key;
}

interface IdentityToolkitResponse {
  idToken?: string;
  error?: { message?: string };
}

/**
 * Trades a Firebase custom token for an ID token, server-side.
 *
 * The Admin SDK cannot do this — `createSessionCookie` insists on an ID token,
 * and only the client SDKs and this REST endpoint can produce one. Calling it
 * from the server is what removes the browser round trip that the WhatsApp
 * flow needs.
 */
export async function exchangeCustomTokenForIdToken(
  customToken: string,
): Promise<string> {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(webApiKey())}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
      cache: 'no-store',
    },
  );

  const payload = (await response.json().catch(() => null)) as
    | IdentityToolkitResponse
    | null;

  const idToken = payload?.idToken;
  if (!response.ok || typeof idToken !== 'string' || idToken === '') {
    // The upstream message names the misconfiguration (a disabled provider, a
    // wrong API key) and goes to the log; the caller gets a generic failure.
    console.error(
      '[email-session] custom token exchange failed:',
      payload?.error?.message ?? `HTTP ${response.status}`,
    );
    throw new EmailSessionError(
      'session_failed',
      'Could not start your session. Please try again.',
    );
  }

  return idToken;
}

export interface SchoolMemberIdentity {
  firebaseUid: string;
  role: UserRole;
  branchId: string | null;
  schoolSlug: string;
  name: string;
}

/**
 * Loads the claims a session needs for a member of one school.
 *
 * Returns null when the person has no row, is deactivated, holds a role the
 * portal does not recognise, or the school itself is gone. Callers must treat
 * every one of those as "cannot sign in" — never as "sign in without a tenant".
 */
export async function loadMemberIdentity(
  locationId: string,
  firebaseUid: string,
): Promise<SchoolMemberIdentity | null> {
  const rows = await db
    .select({
      role: schoolUsers.role,
      branchId: schoolUsers.branchId,
      isActive: schoolUsers.isActive,
      name: schoolUsers.name,
      slug: schools.slug,
    })
    .from(schoolUsers)
    .innerJoin(schools, eq(schools.locationId, schoolUsers.locationId))
    .where(
      and(
        eq(schoolUsers.locationId, locationId),
        eq(schoolUsers.firebaseUid, firebaseUid),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (row === undefined || !row.isActive || !isUserRole(row.role)) return null;

  return {
    firebaseUid,
    role: row.role,
    branchId: row.branchId,
    schoolSlug: row.slug,
    name: row.name,
  };
}

export interface EstablishedSession {
  role: UserRole;
  name: string;
  /** Where the browser should go next, from the role alone. */
  redirect: string;
  /** The signed session cookie, for `applySessionCookie`. */
  sessionCookie: string;
}

/**
 * Mints the claims, exchanges the tokens, and produces the session cookie.
 *
 * Claims are written to Firebase before the token is minted, so the ID token
 * obtained a moment later already carries the tenant — there is no window in
 * which a signed-in user has no school.
 *
 * The cookie is returned rather than written, because the response body has to
 * carry the redirect this computes and a route cannot build the response until
 * it has it. `applySessionCookie` does the writing.
 */
export async function establishEmailSession(
  locationId: string,
  identity: SchoolMemberIdentity,
): Promise<EstablishedSession> {
  const auth = getAdminAuth();

  await auth.setCustomUserClaims(identity.firebaseUid, {
    locationId,
    role: identity.role,
    branchId: identity.branchId,
    schoolSlug: identity.schoolSlug,
  });

  const customToken = await auth.createCustomToken(identity.firebaseUid);
  const idToken = await exchangeCustomTokenForIdToken(customToken);

  return {
    role: identity.role,
    name: identity.name,
    redirect: homeRouteForRole(identity.role),
    sessionCookie: await createSchoolSession(idToken),
  };
}

/** Writes an established session onto the outgoing response. */
export function applySessionCookie(
  response: NextResponse,
  session: EstablishedSession,
): void {
  response.cookies.set({
    ...schoolCookieOptions(sessionExpiryDays() * 24 * 60 * 60),
    value: session.sessionCookie,
  });
}

/**
 * Clears the session cookie on a response.
 *
 * Used by the reset path: whoever just changed the password may not be the
 * person holding the browser that is signed in, so this browser's session goes
 * too. The other devices are dealt with by `revokeSchoolSession`.
 */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({ ...schoolCookieOptions(0), value: '' });
}
