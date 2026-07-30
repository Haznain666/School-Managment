import 'server-only';

import { randomUUID } from 'node:crypto';

import { getAdminStorage } from './firebase-admin';

/**
 * Server-side uploads to Firebase Storage.
 *
 * Path convention platform-wide:
 *   /{locationId}/{branchId}/{type}/{filename}
 * with `_school` standing in for branchId when a file belongs to the school as
 * a whole rather than one campus. The leading `{locationId}` segment is what
 * `storage.rules` matches on, so this shape is what keeps tenants isolated.
 */

export interface UploadResult {
  /** Full object path inside the bucket. */
  storagePath: string;
  /** Stable, publicly fetchable download URL. */
  downloadUrl: string;
}

/** Placeholder branch segment for school-wide assets. */
export const SCHOOL_WIDE_SEGMENT = '_school';

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

/**
 * Uploads a buffer and returns a stable download URL.
 *
 * The URL uses a Firebase download token rather than a signed URL: signed URLs
 * expire after at most seven days, and a school logo has to keep resolving on
 * the login page indefinitely. The token is stored in object metadata, which
 * is exactly what the client SDK's `getDownloadURL` produces.
 */
export async function uploadBuffer(params: {
  storagePath: string;
  buffer: Buffer;
  contentType: string;
  /** Extra metadata for auditing, e.g. who uploaded it. */
  metadata?: Record<string, string>;
}): Promise<UploadResult> {
  const bucket = getAdminStorage().bucket();
  const file = bucket.file(params.storagePath);
  const downloadToken = randomUUID();

  await file.save(params.buffer, {
    contentType: params.contentType,
    resumable: false,
    metadata: {
      contentType: params.contentType,
      // Long cache, but revalidated — logos change rarely and the token stays
      // the same across replacements only if we reuse it (we do not).
      cacheControl: 'public, max-age=3600',
      metadata: {
        ...params.metadata,
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
  });

  const encodedPath = encodeURIComponent(params.storagePath);
  const downloadUrl =
    `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
    `/o/${encodedPath}?alt=media&token=${downloadToken}`;

  return { storagePath: params.storagePath, downloadUrl };
}

/** Removes an object. Missing files are not an error. */
export async function deleteObject(storagePath: string): Promise<void> {
  const bucket = getAdminStorage().bucket();
  await bucket.file(storagePath).delete({ ignoreNotFound: true });
}
