import 'server-only';

/**
 * Firebase ADMIN SDK — server only.
 *
 * One Firebase project ("School-Management") serves every school. Tenants are
 * separated by the `locationId` custom claim, so this module is what mints and
 * verifies the only credential that carries tenant identity.
 *
 * Storage is deliberately absent: files live in Supabase Storage, because
 * Firebase Storage requires the Blaze plan while Authentication and the
 * Realtime Database do not. See `lib/storage.ts`.
 *
 * Requires the Node.js runtime: any route handler or layout that touches it
 * must declare `export const runtime = 'nodejs'`, and it can never be used from
 * Edge middleware.
 */
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';

import { requireServerEnv, serverEnv } from './env';

const ADMIN_APP_NAME = 'sms-platform-admin';

interface ServiceAccountJson {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

/**
 * Strips what a dashboard paste box adds around a value: surrounding
 * whitespace, a UTF-8 BOM, and the matched quotes some editors wrap a value in
 * when it is copied out of a JSON or .env file.
 */
function unwrap(value: string): string {
  let cleaned = value.trim().replace(/^\uFEFF/, '');

  const quoted =
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"));

  if (quoted && cleaned.length >= 2) cleaned = cleaned.slice(1, -1).trim();

  return cleaned;
}

/**
 * Describes a value that could not be parsed, without disclosing it.
 *
 * Length and the first three characters are enough to tell the three real
 * cases apart — correctly encoded base64 of a service account always begins
 * `eyJ`, raw JSON begins `{"t`, and a truncated value shows up as a length far
 * below the ~2.3 kB a real key occupies. None of that is secret: the opening
 * bytes of every service-account file are identical.
 */
function describe(value: string): string {
  return `length ${value.length}, starts with ${JSON.stringify(value.slice(0, 3))}`;
}

/**
 * Reads credentials, preferring the single service-account blob and falling
 * back to the three discrete variables.
 *
 * Both forms are supported because the discrete variables are how Sprint 1
 * configured this; a deployment already running on them should not have to be
 * reconfigured to pick up Sprint 3.
 *
 * ── On accepting more than base64 ────────────────────────────────────────
 * The variable is named `..._KEY` and documented as base64, but the file it is
 * made from is JSON — so pasting the file's own contents is the obvious
 * mistake, and it produced a parse failure indistinguishable from a corrupt
 * blob. Both forms are now accepted: raw JSON is unambiguous (it starts with
 * `{`), so taking it costs nothing and removes a whole class of deployment
 * failure. Base64 is still what the docs recommend, because it survives every
 * dashboard and shell that mangles newlines.
 */
function readCredentials(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const raw = process.env['FIREBASE_SERVICE_ACCOUNT_KEY'];

  if (raw !== undefined && raw.trim() !== '') {
    const value = unwrap(raw);

    // Raw JSON first — it is self-identifying, so there is no ambiguity to
    // resolve. Anything else is treated as base64, tolerating the whitespace a
    // line-wrapping encoder leaves behind and the base64url alphabet.
    const decoded = value.startsWith('{')
      ? value
      : Buffer.from(
          value.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ).toString('utf8');

    let parsed: ServiceAccountJson;
    try {
      parsed = JSON.parse(decoded) as ServiceAccountJson;
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY could not be read as a service account. ' +
          'It is neither raw JSON nor base64-encoded JSON ' +
          `(value: ${describe(value)}; decoded: ${describe(decoded)}). ` +
          'A correct base64 value starts with "eyJ" and is roughly 2-4 kB; ' +
          'raw JSON starts with "{". Regenerate with: base64 -w0 service-account.json',
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
      // Names which field is absent: the usual cause is a Web app config or an
      // OAuth client file downloaded instead of a service-account key, and
      // those are told apart by exactly this.
      const present = Object.keys(parsed).join(', ') || '(none)';
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_KEY parsed as JSON but is not a service ' +
          `account: project_id, client_email and private_key are required, found: ${present}. ` +
          'Download one from Firebase Console → Project Settings → Service accounts.',
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

/**
 * The non-secret half of the resolved credentials.
 *
 * Which project the key actually belongs to is the question behind most
 * Firebase misconfigurations — `auth/configuration-not-found` means either
 * "Authentication was never enabled" or "enabled, but on a different project
 * than this key". Naming the project separates the two, and neither field is
 * a secret: the id appears in every console URL and the service-account
 * address in the IAM list. The private key is never returned.
 */
export function adminCredentialSummary(): {
  projectId: string;
  clientEmail: string;
} {
  const { projectId, clientEmail } = readCredentials();
  return { projectId, clientEmail };
}

function buildAdminApp(): App {
  const { projectId, clientEmail, privateKey } = readCredentials();

  return initializeApp(
    {
      credential: cert({ projectId, clientEmail, privateKey }),
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
