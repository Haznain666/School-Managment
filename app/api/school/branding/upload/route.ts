import { eq } from 'drizzle-orm';

import { schoolBranding, schools } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { extractPalettes } from '@/lib/color-extraction';
import { db } from '@/lib/drizzle';
import { buildStoragePath, deleteObject, uploadBuffer } from '@/lib/storage';

/**
 * POST /api/school/branding/upload
 *
 * Multipart upload of the school's own logo, by the school. Stores it under
 * `/{locationId}/_school/branding/logo.{ext}`, derives three candidate colour
 * palettes, and saves all of it against the tenant on the session.
 *
 * ── Why this exists beside the Super Admin route ─────────────────────────
 * Both write the same row through the same helpers. The difference is the
 * tenant: this one takes it from verified claims, so the storage path a school
 * can write to is fixed by their session and cannot be redirected at another
 * school's folder by editing a request. That is also exactly what
 * `storage.rules` matches on, so the two agree.
 *
 * The palettes are generated here rather than on demand because extraction
 * costs an image decode; doing it once at upload keeps every later page render
 * a simple read.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const form = await request.formData();
      const file = form.get('logo');

      if (!(file instanceof File)) {
        return apiFailure('invalid_body', 'Attach a logo file as "logo".', 400);
      }

      if (file.size === 0) {
        return apiFailure('invalid_body', 'The uploaded file is empty.', 400);
      }

      if (file.size > MAX_BYTES) {
        return apiFailure('file_too_large', 'Logo must be 2 MB or smaller.', 413);
      }

      const extension = ALLOWED_TYPES[file.type];
      if (extension === undefined) {
        return apiFailure(
          'unsupported_type',
          'Logo must be a PNG, JPG, SVG or WebP image.',
          415,
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      // Path pattern is /{locationId}/{branchId}/{type}/{filename}; a logo
      // belongs to the school rather than one campus. The locationId is the
      // session's, never the request's.
      const storagePath = buildStoragePath({
        locationId: auth.locationId,
        branchId: null,
        type: 'branding',
        filename: `logo.${extension}`,
      });

      const existing = await db
        .select()
        .from(schoolBranding)
        .where(eq(schoolBranding.locationId, auth.locationId))
        .limit(1);

      const previous = existing[0];

      const [upload, palettes] = await Promise.all([
        uploadBuffer({
          storagePath,
          buffer,
          contentType: file.type,
          metadata: { uploadedByUid: auth.uid, locationId: auth.locationId },
        }),
        // SVGs are rasterised by sharp before extraction; if that fails,
        // extractPalettes falls back to defaults rather than throwing.
        extractPalettes(buffer),
      ]);

      const [palette0, palette1, palette2] = palettes;
      const now = new Date();

      await db
        .insert(schoolBranding)
        .values({
          locationId: auth.locationId,
          logoUrl: upload.downloadUrl,
          logoStoragePath: upload.storagePath,
          // A fresh set of palettes invalidates the previous choice.
          selectedPalette: 0,
          palette0: palette0 ?? null,
          palette1: palette1 ?? null,
          palette2: palette2 ?? null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schoolBranding.locationId,
          set: {
            logoUrl: upload.downloadUrl,
            logoStoragePath: upload.storagePath,
            selectedPalette: 0,
            palette0: palette0 ?? null,
            palette1: palette1 ?? null,
            palette2: palette2 ?? null,
            updatedAt: now,
          },
        });

      await db
        .update(schools)
        .set({ logoUrl: upload.downloadUrl, updatedAt: now })
        .where(eq(schools.locationId, auth.locationId));

      // Remove the superseded object only after the new one is committed, and
      // only when the path actually changed (a different file extension).
      if (
        previous?.logoStoragePath != null &&
        previous.logoStoragePath !== upload.storagePath
      ) {
        try {
          await deleteObject(previous.logoStoragePath);
        } catch (error) {
          // A stale object is untidy, not a failure of this request.
          console.error('[school/branding] could not remove previous logo:', error);
        }
      }

      return apiSuccess({
        logoUrl: upload.downloadUrl,
        palettes,
        selectedPalette: 0,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'settings.write' },
);
