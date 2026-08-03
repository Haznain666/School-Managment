import 'server-only';

import { getAdminApp, getAdminStorage } from './firebase-admin';
import { serverEnv } from './env';

/**
 * Resolving which Cloud Storage bucket this deployment actually owns.
 *
 * ── The failure this exists to prevent ───────────────────────────────────
 * Firebase changed the default bucket name for projects created on or after
 * 30 October 2024: they get `<project-id>.firebasestorage.app`, where older
 * projects got `<project-id>.appspot.com`. The Admin SDK does not know which
 * era a project belongs to, and neither did this codebase — it guessed
 * `.appspot.com` unconditionally.
 *
 * On a newer project that guess names a bucket that has never existed, and
 * every upload fails with GCS's own message, "The specified bucket does not
 * exist". That message names no bucket, so it reads like a broken integration
 * rather than a one-line configuration difference, which is exactly how it was
 * first reported.
 *
 * ── What this does instead ───────────────────────────────────────────────
 * An explicit `FIREBASE_ADMIN_STORAGE_BUCKET` always wins — a deployment that
 * has said which bucket it means is never second-guessed, and no probe is
 * issued. Only when it is absent are the two conventional names tried, newest
 * first, and the answer memoised for the life of the process.
 *
 * When neither exists, the error names both candidates and says what to do.
 * The cost of a bad guess here is a school unable to upload its logo; the cost
 * of one extra `bucket.exists()` on cold start is a few hundred milliseconds,
 * once.
 */

/** Raised when no usable bucket can be determined. Actionable by design. */
export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConfigError';
  }
}

/**
 * Normalises what someone actually pastes into a dashboard field.
 *
 * `gs://my-bucket` is what the Firebase console shows and the single most
 * likely thing to be copied, but the Admin SDK wants the bare name and fails
 * obscurely on the URL form. Trailing slashes and stray quotes come from the
 * same place.
 */
export function normalizeBucketName(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/^gs:\/\//i, '')
    .replace(/\/+$/, '')
    .trim();
}

/** The two conventions, newest first. */
export function bucketCandidates(projectId: string): string[] {
  return [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];
}

let cached: string | null = null;

/** Clears the memoised name. For diagnostics that want a fresh probe. */
export function resetBucketCache(): void {
  cached = null;
}

/** The project id the admin credentials resolved to. */
function adminProjectId(): string {
  const projectId = getAdminApp().options.projectId;

  if (projectId === undefined || projectId === '') {
    throw new StorageConfigError(
      'The Firebase Admin credentials carry no project id, so no Storage ' +
        'bucket can be resolved. Check FIREBASE_SERVICE_ACCOUNT_KEY.',
    );
  }

  return projectId;
}

/**
 * The bucket name this deployment should write to.
 *
 * @throws {StorageConfigError} when nothing usable can be found.
 */
export async function resolveBucketName(): Promise<string> {
  if (cached !== null) return cached;

  const configured = normalizeBucketName(serverEnv('FIREBASE_ADMIN_STORAGE_BUCKET', ''));

  if (configured !== '') {
    // Trusted without a probe. An operator who named a bucket meant it, and a
    // probe here would only add a round trip and a new way to fail.
    cached = configured;
    return cached;
  }

  const projectId = adminProjectId();
  const candidates = bucketCandidates(projectId);

  for (const name of candidates) {
    try {
      const [exists] = await getAdminStorage().bucket(name).exists();
      if (exists) {
        cached = name;
        return cached;
      }
    } catch (error) {
      // A permission error on one candidate must not hide a working other, so
      // this is logged and the loop continues rather than rethrowing.
      console.warn(`[storage] could not probe bucket "${name}":`, error);
    }
  }

  throw new StorageConfigError(
    `No Cloud Storage bucket was found for Firebase project "${projectId}". ` +
      `Tried ${candidates.map((name) => `"${name}"`).join(' and ')}. ` +
      'Open Firebase Console → Build → Storage and click "Get started" if you ' +
      'have never enabled it; the bucket is created for you. Then set ' +
      'FIREBASE_ADMIN_STORAGE_BUCKET to the name shown there, without the ' +
      '"gs://" prefix.',
  );
}

/** The resolved bucket handle. */
export async function getStorageBucket() {
  return getAdminStorage().bucket(await resolveBucketName());
}

/**
 * What the diagnostics endpoint reports. Never returns a secret: a bucket name
 * is public — it appears in every download URL the app already serves.
 */
export interface BucketDiagnostics {
  projectId: string;
  configured: string | null;
  resolved: string | null;
  candidates: Array<{ name: string; exists: boolean | null; error: string | null }>;
}

export async function inspectBuckets(): Promise<BucketDiagnostics> {
  const projectId = adminProjectId();
  const configuredRaw = normalizeBucketName(
    serverEnv('FIREBASE_ADMIN_STORAGE_BUCKET', ''),
  );
  const configured = configuredRaw === '' ? null : configuredRaw;

  // The configured name is probed here even though `resolveBucketName` trusts
  // it: this endpoint exists to answer "is my configuration right?", and
  // taking it on faith would defeat the point.
  const names = configured === null ? bucketCandidates(projectId) : [configured];

  const candidates: BucketDiagnostics['candidates'] = [];
  let resolved: string | null = null;

  for (const name of names) {
    try {
      const [exists] = await getAdminStorage().bucket(name).exists();
      candidates.push({ name, exists, error: null });
      if (exists && resolved === null) resolved = name;
    } catch (error) {
      candidates.push({
        name,
        exists: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { projectId, configured, resolved, candidates };
}
