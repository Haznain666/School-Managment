import 'server-only';

/**
 * Firebase ADMIN SDK — server only (CRITICAL RULE #7).
 *
 * Used to verify ID tokens and to mint the custom claims that carry tenant
 * identity. Requires the Node.js runtime, so any route handler that touches it
 * must declare `export const runtime = 'nodejs'`.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { parseUserClaims, type UserClaims } from './claims';
import { requireServerEnv, serverEnv } from './env';

const ADMIN_APP_NAME = 'sms-platform-admin';

function buildAdminApp(): App {
  const projectId = requireServerEnv('FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = requireServerEnv('FIREBASE_ADMIN_CLIENT_EMAIL');

  // Vercel and most CI systems store the PEM with literal "\n" sequences.
  const privateKey = requireServerEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(
    /\\n/g,
    '\n',
  );

  return initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
      storageBucket: serverEnv('FIREBASE_ADMIN_STORAGE_BUCKET', `${projectId}.appspot.com`),
      databaseURL: serverEnv(
        'FIREBASE_ADMIN_DATABASE_URL',
        `https://${projectId}-default-rtdb.firebaseio.com`,
      ),
    },
    ADMIN_APP_NAME,
  );
}

/** Lazily initialised so that importing this module never throws at build time. */
export function getAdminApp(): App {
  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  return existing ?? buildAdminApp();
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminStorage(): Storage {
  return getStorage(getAdminApp());
}

export function getAdminDatabase(): Database {
  return getDatabase(getAdminApp());
}

/** Re-exported so callers do not need a direct firebase-admin import. */
export type { DecodedIdToken };

/**
 * Verifies an ID token and returns the decoded payload.
 * `checkRevoked` forces a round-trip to Firebase so that a disabled account or
 * a revoked session is rejected immediately rather than at token expiry.
 */
export async function verifyIdToken(
  idToken: string,
  checkRevoked = true,
): Promise<DecodedIdToken> {
  return getAdminAuth().verifyIdToken(idToken, checkRevoked);
}

/**
 * Writes the tenant claims onto a Firebase user.
 *
 * The user must refresh their ID token (`getIdToken(true)`) before the new
 * claims appear — existing tokens keep the old values until they expire.
 */
export async function setUserClaims(uid: string, claims: UserClaims): Promise<void> {
  await getAdminAuth().setCustomUserClaims(uid, {
    location_id: claims.location_id,
    role: claims.role,
    branch_id: claims.branch_id,
    is_dual_role: claims.is_dual_role,
  });
}

/** Reads the tenant claims currently attached to a Firebase user. */
export async function getUserClaims(uid: string): Promise<UserClaims | null> {
  const user = await getAdminAuth().getUser(uid);
  return parseUserClaims(user.customClaims ?? {});
}

/**
 * Invalidates every outstanding refresh token for a user. Call this whenever
 * their role, branch or school changes so stale claims cannot be replayed.
 */
export async function revokeUserSessions(uid: string): Promise<void> {
  await getAdminAuth().revokeRefreshTokens(uid);
}
