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

/**
 * Default bucket name, overridable per deployment with
 * `SUPABASE_STORAGE_BUCKET`.
 *
 * This was `school-files` and **no such bucket has ever existed**. The bucket
 * in the project is `school-assets`, created 2026-08-03, and nothing reconciled
 * the two — so every logo upload since then failed, and the Branding tab was
 * unusable. Changed to match the bucket that is actually there rather than
 * carried as an environment variable every deployment must remember to set: a
 * default that matches nothing is not a default.
 */
const DEFAULT_BUCKET = 'school-assets';

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

/**
 * The headers every Supabase Storage request needs.
 *
 * ── Why `apikey` as well as `Authorization` ──────────────────────────────
 * Both. Supabase's API gateway authenticates on the `apikey` header; the
 * Storage service behind it reads `Authorization` to decide the caller's role.
 * `supabase-js` sends both on every request, and so must anything speaking to
 * the REST API directly.
 *
 * Sending only `Authorization` happens to work with a legacy `service_role`
 * JWT, because the gateway will accept a JWT there in place of `apikey`. It
 * does not work with the newer `sb_secret_…` keys, which the gateway resolves
 * from `apikey` alone — the request is rejected before Storage ever sees it,
 * and the reply is a bare HTTP 400 whose body says "No API key found in
 * request". That is the failure this function exists to prevent, and it was a
 * real bug: the first cut of this module sent `Authorization` only.
 */
function storageHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = serviceRoleKey();

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

/**
 * Which kind of credential `SUPABASE_SERVICE_ROLE_KEY` holds.
 *
 * Supabase issues two generations of key. The legacy pair are JWTs whose
 * payload names the role (`anon` or `service_role`); the current pair are
 * opaque strings prefixed `sb_publishable_` and `sb_secret_`. Both generations
 * are accepted here — a project on either should work without touching code.
 *
 * The distinction that matters is not old versus new but public versus
 * secret: `anon` and `sb_publishable_` are meant to ship to browsers and are
 * refused by Storage policies, while `service_role` and `sb_secret_` carry
 * full access. Naming the kind lets the diagnostic say which mistake was made
 * rather than "the key is wrong".
 */
export type SupabaseKeyKind =
  | 'secret'
  | 'publishable'
  | 'jwt_service_role'
  | 'jwt_anon'
  | 'jwt_unknown_role'
  | 'unrecognised';

/** Reads the `role` claim out of a JWT without verifying its signature. */
function jwtRole(key: string): string | null {
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

export function classifyKey(key: string): SupabaseKeyKind {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';

  if (key.startsWith('eyJ')) {
    const role = jwtRole(key);
    if (role === 'service_role') return 'jwt_service_role';
    if (role === 'anon') return 'jwt_anon';
    return 'jwt_unknown_role';
  }

  return 'unrecognised';
}

/** Whether the key can actually write to Storage. */
export function keyGrantsFullAccess(kind: SupabaseKeyKind): boolean {
  return kind === 'secret' || kind === 'jwt_service_role';
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

/**
 * Whether a failed Storage response means "that bucket is not there".
 *
 * ── Why this cannot just check `status === 404` ──────────────────────────
 * Supabase Storage answers a request for a bucket that does not exist with
 * **HTTP 400**, and puts the real code in the body:
 *
 *     HTTP/1.1 400
 *     {"statusCode":"404","error":"Bucket not found",
 *      "message":"Bucket not found","code":"NoSuchBucket"}
 *
 * The transport status and the body's `statusCode` disagree, and the body is
 * the one telling the truth. A `status === 404` test therefore never matched,
 * so the actionable message below was dead code and the operator got the
 * generic "upload failed (HTTP 400)" instead — which reads like a malformed
 * request, and sends the investigation at the file rather than at the config.
 * That is exactly how this went unnoticed: the Branding tab has been broken
 * since 2026-08-03 and never said why.
 *
 * Matched on the body rather than the status for that reason, and kept
 * tolerant of either, since Supabase may well align them later.
 */
function looksLikeMissingBucket(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false;

  return (
    /NoSuchBucket/i.test(body) ||
    /bucket not found/i.test(body) ||
    (status === 404 && /bucket/i.test(body))
  );
}

/** Turns a non-2xx Storage response into a message worth reading. */
async function storageFailure(response: Response, action: string): Promise<never> {
  let detail: string;
  try {
    detail = (await response.text()).slice(0, 300);
  } catch {
    detail = '(no response body)';
  }

  if (looksLikeMissingBucket(response.status, detail)) {
    throw new StorageConfigError(
      `The Supabase Storage bucket "${bucketName()}" does not exist in this ` +
        'project. Create it in Supabase → Storage → New bucket and mark it ' +
        'Public, or set SUPABASE_STORAGE_BUCKET to the name of the bucket you ' +
        'already have.',
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
    headers: storageHeaders({
      'Content-Type': params.contentType,
      'cache-control': 'public, max-age=3600',
      'x-upsert': 'true',
    }),
    // A Buffer is a Uint8Array, which fetch accepts as a body directly.
    body: new Uint8Array(params.buffer),
  });

  if (!response.ok) await storageFailure(response, 'upload');

  return {
    storagePath: params.storagePath,
    downloadUrl: publicUrl(params.storagePath, Date.now()),
  };
}

/** An object read back out of Storage, ready to be streamed to a caller. */
export interface DownloadedObject {
  bytes: ArrayBuffer;
  /** What Storage says it is, which is what was sent on upload. */
  contentType: string;
}

/**
 * Reads an object back through the service-role key.
 *
 * ── Why this exists when the bucket is public ────────────────────────────
 * Because "public bucket" and "public file" are not the same decision, and
 * feedback attachments are the first files in this product where they come
 * apart. A logo is meant to be fetched by anybody who loads the school's login
 * page. A screenshot attached to a bug report is a picture of a school's own
 * data — a fee register, a student list — and its public URL would hand that to
 * anyone who ever saw the link, forever, with no session behind it.
 *
 * So the path is never published. The route that serves it verifies the caller
 * first, calls this, and streams the bytes back with
 * `Content-Disposition: attachment`. A uuid in a path is obscurity, not access
 * control, and the difference matters the day a link is pasted into a chat.
 *
 * Returns null for a missing object rather than throwing: a row whose file has
 * been removed is a 404 to the caller, not a 500.
 */
export async function downloadObject(storagePath: string): Promise<DownloadedObject | null> {
  const endpoint = `${supabaseUrl()}/storage/v1/object/${bucketName()}/${encodePath(storagePath)}`;

  const response = await fetch(endpoint, { method: 'GET', headers: storageHeaders() });

  if (response.status === 404) return null;
  if (!response.ok) await storageFailure(response, 'download');

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

/** Removes an object. Missing files are not an error. */
export async function deleteObject(storagePath: string): Promise<void> {
  const endpoint = `${supabaseUrl()}/storage/v1/object/${bucketName()}/${encodePath(storagePath)}`;

  const response = await fetch(endpoint, {
    method: 'DELETE',
    headers: storageHeaders(),
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
  /** Which generation and privilege of key was supplied. */
  keyKind: SupabaseKeyKind | null;
  /** True when the key can write to Storage — secret or service_role. */
  serviceKeyLooksCorrect: boolean | null;
  bucketExists: boolean | null;
  bucketIsPublic: boolean | null;
  error: string | null;
  /**
   * Supabase's own response body when the bucket read failed.
   *
   * "HTTP 400" alone sent a real investigation down the wrong path once: the
   * body said "No API key found in request", which names the cause exactly,
   * and discarding it turned a one-line fix into a guess. Storage error
   * bodies carry no credentials.
   */
  errorBody: string | null;
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
      keyKind: null,
      serviceKeyLooksCorrect: null,
      bucketExists: null,
      bucketIsPublic: null,
      error: error instanceof Error ? error.message : String(error),
      errorBody: null,
    };
  }

  const keyKind = classifyKey(key);
  const looksCorrect = keyGrantsFullAccess(keyKind);

  try {
    const response = await fetch(
      `${url}/storage/v1/bucket/${encodeURIComponent(bucket)}`,
      { method: 'GET', headers: storageHeaders() },
    );

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = (await response.text()).slice(0, 300);
      } catch {
        errorBody = '(no response body)';
      }

      // Read the body, not the status — see `looksLikeMissingBucket`. Before
      // this, a missing bucket arrived as HTTP 400 and was reported as
      // `bucketExists: null` with a shrug, which is the least useful answer
      // the diagnostic could give about the one thing it exists to check.
      if (looksLikeMissingBucket(response.status, errorBody)) {
        return {
          supabaseUrl: url,
          bucket,
          serviceKeyPresent: true,
          keyKind,
          serviceKeyLooksCorrect: looksCorrect,
          bucketExists: false,
          bucketIsPublic: null,
          error:
            `Bucket "${bucket}" does not exist in this project. Create it, or ` +
            'set SUPABASE_STORAGE_BUCKET to the name of the one you have.',
          errorBody,
        };
      }

      return {
        supabaseUrl: url,
        bucket,
        serviceKeyPresent: true,
        keyKind,
        serviceKeyLooksCorrect: looksCorrect,
        bucketExists: null,
        bucketIsPublic: null,
        error: `Supabase returned HTTP ${response.status} when reading the bucket.`,
        errorBody,
      };
    }

    const body = (await response.json()) as { public?: unknown };

    return {
      supabaseUrl: url,
      bucket,
      serviceKeyPresent: true,
      keyKind,
      serviceKeyLooksCorrect: looksCorrect,
      bucketExists: true,
      bucketIsPublic: body.public === true,
      error: null,
      errorBody: null,
    };
  } catch (error) {
    return {
      supabaseUrl: url,
      bucket,
      serviceKeyPresent: true,
      keyKind,
      serviceKeyLooksCorrect: looksCorrect,
      bucketExists: null,
      bucketIsPublic: null,
      error: error instanceof Error ? error.message : String(error),
      errorBody: null,
    };
  }
}
