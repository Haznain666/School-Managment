import 'server-only';

/**
 * Firebase ADMIN SDK — server only.
 *
 * One Firebase project ("School-Management") serves every school. Tenants are
 * separated by the `locationId` custom claim, so this module is what mints and
 * verifies the only credential that carries tenant identity.
 *
 * Requires the Node.js runtime: any route handler or layout that touches it
 * must declare `export const runtime = 'nodejs'`, and it can never be used from
 * Edge middleware.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getStorage, type Storage } from 'firebase-admin/storage';

import { requireServerEnv, serverEnv } from './env';

const ADMIN_APP_NAME = 'sms-platform-admin';

interface ServiceAccountJson {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

/**
 * Reads credentials, preferring the single base64 service-account blob and
 * falling back to the three discrete variables.
 *
 * Both forms are supported because the discrete variables are how Sprint 1
 * configured this; a deployment already running on them should not have to be
 * reconfigured to pick up Sprint 3.
 */
function readCredentials(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const encoded = process.env['FIREBASE_SERVICE_ACCOUNT_KEY'];

  if (encoded !== undefined && encoded.trim() !== '') {
    let parsed: ServiceAccountJson;
    try {
      parsed = JSON.parse(
        Buffer.from(encoded, 'base64').toString('utf8'),
      ) as ServiceAccountJson;
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is not valid base64-encoded JSON. ' +
          'Generate it with: base64 -w0 service-account.json',
      );
    }

    const {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    } = parsed;

    if (
      typeof projectId !== 'string' ||
      typeof clientEmail !== 'string' ||
      typeof privateKey !== 'string'
    ) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY is missing project_id, client_email or private_key.',
      );
    }

    return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') };
  }

  return {
    projectId: requireServerEnv('FIREBASE_ADMIN_PROJECT_ID'),
    clientEmail: requireServerEnv('FIREBASE_ADMIN_CLIENT_EMAIL'),
    privateKey: requireServerEnv('FIREBASE_ADMIN_PRIVATE_KEY').replace(/\\n/g, '\n'),
  };
}

function buildAdminApp(): App {
  const { projectId, clientEmail, privateKey } = readCredentials();

  return initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
      storageBucket: serverEnv(
        'FIREBASE_ADMIN_STORAGE_BUCKET',
        `${projectId}.appspot.com`,
      ),
      databaseURL: serverEnv(
        'FIREBASE_ADMIN_DATABASE_URL',
        `https://${projectId}-default-rtdb.firebaseio.com`,
      ),
    },
    ADMIN_APP_NAME,
  );
}

/**
 * Lazily initialised and reused across hot reloads — `initializeApp` throws if
 * the same app name is registered twice.
 */
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

export type { DecodedIdToken };

/**
 * Verifies an ID token. `checkRevoked` forces a round-trip to Firebase so a
 * disabled account or revoked session is rejected immediately.
 */
export async function verifyIdToken(
  idToken: string,
  checkRevoked = true,
): Promise<DecodedIdToken> {
  return getAdminAuth().verifyIdToken(idToken, checkRevoked);
}
