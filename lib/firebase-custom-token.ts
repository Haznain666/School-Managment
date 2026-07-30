import 'server-only';

import { createHash } from 'node:crypto';

import type { SchoolCustomClaims } from '@/types/school-auth';

import { getAdminAuth } from './firebase-admin';

/**
 * Firebase accounts for phone-first, passwordless sign-in.
 *
 * These users authenticate by WhatsApp passcode, so they have no email and no
 * password. The server verifies the passcode itself and then mints a Firebase
 * custom token, which the browser exchanges for an ID token and finally a
 * session cookie.
 *
 * The uid is derived from the school and the phone number rather than being
 * random, which makes the mapping idempotent: repeated sign-ins, a resent
 * invite, or a retried request all land on the same account instead of
 * quietly creating duplicates for one person.
 */

/** `su_` + 24 hex characters — far inside Firebase's 128-character limit. */
export function deriveSchoolUid(locationId: string, phone: string): string {
  const digest = createHash('sha256')
    .update(`${locationId}:${phone}`)
    .digest('hex')
    .slice(0, 24);

  return `su_${digest}`;
}

function isUserNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'auth/user-not-found'
  );
}

/** Returns the Firebase uid for this school+phone, creating it if absent. */
export async function getOrCreateSchoolFirebaseUser(
  locationId: string,
  phone: string,
): Promise<string> {
  const uid = deriveSchoolUid(locationId, phone);
  const auth = getAdminAuth();

  try {
    await auth.getUser(uid);
    return uid;
  } catch (error) {
    if (!isUserNotFound(error)) throw error;
  }

  try {
    // No email and no password: the passcode already proved possession of the
    // handset, and this account can only ever be reached through that flow.
    await auth.createUser({ uid });
  } catch (error) {
    // A concurrent request may have created it in the gap above.
    if (!isAlreadyExists(error)) throw error;
  }

  return uid;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'auth/uid-already-exists'
  );
}

/**
 * Stamps tenant claims onto the account and returns a custom token for it.
 *
 * Claims are written before the token is minted, so the ID token the client
 * obtains already carries the tenant — there is no window in which a signed-in
 * user has no school.
 */
export async function issueSchoolCustomToken(
  locationId: string,
  phone: string,
  claims: SchoolCustomClaims,
): Promise<{ uid: string; customToken: string }> {
  const uid = await getOrCreateSchoolFirebaseUser(locationId, phone);
  const auth = getAdminAuth();

  await auth.setCustomUserClaims(uid, {
    locationId: claims.locationId,
    role: claims.role,
    branchId: claims.branchId,
    schoolSlug: claims.schoolSlug,
  });

  return { uid, customToken: await auth.createCustomToken(uid) };
}
