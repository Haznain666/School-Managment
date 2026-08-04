import 'server-only';

import { requireServerEnv, serverEnv } from './env';

/**
 * Server-side uploads to Supabase Storage.
 *
 * ── Why Supabase and not Firebase ────────────────────────────────────────
 * Firebase Storage requires the Blaze (pay-as-you-go) plan. Everything else
 * this application uses Firebase for — Authentication, custom claims, the
 * Realtime Database — is available on the free tier, so files were the only
 * thing forcing a billing account. They now live in Supabase Storage instead.
 * Firebase remains the identity provider; nothing about sessions changed.
 *
 * ── Why raw REST rather than @supabase/supabase-js ───────────────────────
 * Three calls are needed: upload, delete, and "does the bucket exist". Each is
 * a single `fetch` against a documented, stable endpoint. Pulling in the SDK
 * for that would add a dependency — and its auth, realtime and postgrest
 * modules — to the server bundle for no capability this code uses.
 *
 * ── Path convention, unchanged ───────────────────────────────────────────
 *   /{locationId}/{branchId}/{type}/{filename}
 * with `_school` standing in for branchId when a file belongs to the school as
 * a whole rather than one campus. Under Firebase this shape was what
 * `storage.rules` matched on to keep tenants apart. Under Supabase the same
 * isolation comes from the service-role key never leaving the server: no
 * browser ever holds a credential that can write to Storage, and every path is
 * built here from a verified `locationId` rather than from request input.
 */

/** Raised when Storage is not configured or the bucket is unreachable. */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

export interface UploadResult {
  /** Full object path inside the bucket. */
  storagePath: string;
  /** Publicly fetchable URL, cache-busted per upload. */
  downloadUrl: string;
}

/** Placeholder branch segment for school-wide assets. */
export const SCHOOL_WIDE_SEGMENT = '_school';

/** Default bucket name, overridable per deployment. */
const DEFAULT_BUCKET = 'school-files';

/**
 * Builds a tenant-scoped object path.
 * `branchId` of null means the file belongs to the whole school.
 */
export function buildStoragePath(params: {
  locationId: string;
  branchId: string | null;
  type: string;
  filename: string;
}): string {
  const branchSegment = params.branchId ?? SCHOOL_WIDE_SEGMENT;
  return `${params.locationId}/${branchSegment}/${params.type}/${params.filename}`;
}

/** `https://abc.supabase.co`, with any trailing slash removed. */
function supabaseUrl(): string {
  const raw = requireServerEnv('SUPABASE_URL').trim().replace(/\/+$/, '');

  if (!/^https:\/\//i.test(raw)) {
    throw new StorageConfigError(
      'SUPABASE_URL must be the full https URL of your project, e.g. ' +
        `"https://abcdefgh.supabase.co". Got "${raw}".`,
    );
  }

  return raw;
}

/**
 * The service-role key.
 *
 * This bypasses row-level security and every Storage policy, which is exactly
 * why it may never reach the browser. It is read through `requireServerEnv`
 * inside a `server-only` module, and the variable is deliberately not prefixed
 * `NEXT_PUBLIC_` — that prefix would inline it into the client bundle and hand
 * every visitor full write access to the project.
 */
function serviceRoleKey(): string {
  return requireServerEnv('SUPABASE_SERVICE_ROLE_KEY').trim();
}

/** The bucket every upload lands in. */
export function bucketName(): string {
  return serverEnv('SUPABASE_STORAGE_BUCKET', DEFAULT_BUCKET).trim();
}

/**
 * Refuses a path that could address something outside its tenant prefix.
 *
 * ── Why this is not paranoia ─────────────────────────────────────────────
 * Under Firebase, `storage.rules` matched on the leading `{locationId}`
 * segment, so tenant isolation held even if a caller built a path carelessly.
 * Supabase writes here go out under the service-role key, which bypasses every
 * Storage policy — so the path is now the *only* thing separating one school's
 * files from another's.
 *
 * Nothing reaching these functions today is user-controlled: every path is
 * assembled from a verified `locationId` and a validated uuid. This exists so
 * that a future call site which forgets that fails loudly here, rather than
 * quietly writing into a neighbouring school's prefix. `encodeURIComponent`
 * would not have caught it — it leaves `..` untouched.
 */
function assertSafePath(storagePath: string): void {
  const segments = storagePath.split('/');

  const unsafe =
    storagePath === '' ||
    storagePath.startsWith('/') ||
    storagePath.includes('\\') ||
    storagePath.includes('\0') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');

  if (unsafe) {
    throw new StorageConfigError(
      `Refusing to use the storage path "${storagePath}": a path must be ` +
        'relative, non-empty, and free of "." or ".." segments.',
    );
  }
}

/** Encodes each path segment while leaving the separators intact. */
function encodePath(storagePath: string): string {
  assertSafePath(storagePath);
  return storagePath.split('/').map(encodeURIComponent).join('/');
}

/**
 * The public URL for an object.
 *
 * ── On the `v` parameter ─────────────────────────────────────────────────
 * A logo is written to a fixed path (`.../branding/logo.png`) and replaced in
 * place, so its public URL never changes. Firebase avoided the resulting stale
 * cache by minting a fresh download token on every upload, which produced a
 * new URL each time; Supabase public URLs derive from the path alone and have
 * no such token.
 *
 * Without a cache buster a school would upload a new logo, still see the old
 * one, and reasonably conclude the upload had failed. The stored URL therefore
 * carries the upload's timestamp. Supabase ignores unknown query parameters,
 * and the value changes only when the object does.
 */
export function publicUrl(storagePath: string, version?: number): string {
  const base = `${supabaseUrl()}/storage/v1/object/public/${bucketName()}/${encodePath(storagePath)}`;
  return version === undefined ? base : `${base}?v=${version}`;
}

/** Turns a non-2xx Storage response into a message worth reading. */
async function storageFailure(response: Response, action: string): Promise<never> {
  let detail: string;
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '(no response body)';
  }

  if (response.status === 404 && /bucket/i.test(detail)) {
    throw new StorageConfigError(
      `The Supabase Storage bucket "${bucketName()}" does not exist. ` +
        'Create it in Supabase → Storage → New bucket, mark it Public, then ' +
        'set SUPABASE_STORAGE_BUCKET to its name.',
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new StorageConfigError(
      `Supabase refused the ${action} (HTTP ${response.status}). Check that ` +
        'SUPABASE_SERVICE_ROLE_KEY is the service_role key — not the anon key — ' +
        'and that it belongs to the project named in SUPABASE_URL.',
    );
  }

  throw new Error(
    `Supabase Storage ${action} failed (HTTP ${response.status}): ${detail}`,
  );
}

/**
 * Uploads a buffer and returns a public URL.
 *
 * `x-upsert` is set because every caller writes to a deterministic path and
 * means to replace what is there: a school uploading a second logo is
 * correcting the first, not adding one.
 */
export async function uploadBuffer(params: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
}): Promise<UploadResult> {
  const endpoint = `${supabaseUrl()}/storage/v1/object/${bucketName()}/${encodePath(params.storagePath)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      'Content-Type': params.contentType,
      'cache-control': 'public, max-age=3600',
      'x-upsert': 'true',
    },
    // A Buffer is a Uint8Array, which fetch accepts as a body directly.
    body: new Uint8Array(params.buffer),
  });

  if (!response.ok) await storageFailure(response, 'upload');

  return {
    storagePath: params.storagePath,
    downloadUrl: publicUrl(params.storagePath, Date.now()),
  };
}

/** Removes an object. Missing files are not an error. */
export async function deleteObject(storagePath: string): Promise<void> {
  const endpoint = `${supabaseUrl()}/storage/v1/object/${bucketName()}/${encodePath(storagePath)}`;

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${serviceRoleKey()}` },
  });

  // 404 means the object is already gone, which is the state the caller wanted.
  if (!response.ok && response.status !== 404) {
    await storageFailure(response, 'delete');
  }
}

/**
 * What the diagnostics endpoint reports.
 *
 * Never returns a key. The URL and bucket name are not secrets — both appear
 * in every public object URL this application already serves.
 */
export interface StorageDiagnostics {
  supabaseUrl: string | null;
  bucket: string;
  serviceKeyPresent: boolean;
  /** True when the key is a service_role JWT rather than the anon key. */
  serviceKeyLooksCorrect: boolean | null;
  bucketExists: boolean | null;
  bucketIsPublic: boolean | null;
  error: string | null;
}

/**
 * Reads the `role` claim out of the key without verifying it.
 *
 * Pasting the anon key where the service_role key belongs is the single most
 * likely misconfiguration — the two sit side by side in the Supabase dashboard
 * and look alike. Both are JWTs whose payload names the role in clear, so
 * telling them apart needs no signature check and no secret.
 */
function keyRole(key: string): string | null {
  const payload = key.split('.')[1];
  if (payload === undefined) return null;

  try {
    const json = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, '+').replace(/_/g, '/'),
        'base64',
      ).toString('utf8'),
    ) as { role?: unknown };

    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

export async function inspectStorage(): Promise<StorageDiagnostics> {
  const bucket = bucketName();

  let url: string | null = null;
  let key = '';

  try {
    url = supabaseUrl();
    key = serviceRoleKey();
  } catch (error) {
    return {
      supabaseUrl: url,
      bucket,
      serviceKeyPresent: key !== '',
      serviceKeyLooksCorrect: null,
      bucketExists: null,
      bucketIsPublic: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const looksCorrect = keyRole(key) === 'service_role';

  try {
    const response = await fetch(
      `${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
    );

    if (response.status === 404) {
      return {
        supabaseUrl: url,
        bucket,
        serviceKeyPresent: true,
        serviceKeyLooksCorrect: looksCorrect,
        bucketExists: false,
        bucketIsPublic: null,
        error: `Bucket "${bucket}" does not exist in this project.`,
      };
    }

    if (!response.ok) {
      return {
        supabaseUrl: url,
        bucket,
        serviceKeyPresent: true,
        serviceKeyLooksCorrect: looksCorrect,
        bucketExists: null,
        bucketIsPublic: null,
        error: `Supabase returned HTTP ${response.status} when reading the bucket.`,
      };
    }

    const body = (await response.json()) as { public?: unknown };

    return {
      supabaseUrl: url,
      bucket,
      serviceKeyPresent: true,
      serviceKeyLooksCorrect: looksCorrect,
      bucketExists: true,
      bucketIsPublic: body.public === true,
      error: null,
    };
  } catch (error) {
    return {
      supabaseUrl: url,
      bucket,
      serviceKeyPresent: true,
      serviceKeyLooksCorrect: looksCorrect,
      bucketExists: null,
      bucketIsPublic: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
