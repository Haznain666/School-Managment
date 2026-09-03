import { and, eq } from 'drizzle-orm';

import { staff } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getStaff } from '@/lib/hr-queries';
import { uploadBuffer } from '@/lib/storage';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/hr/staff/[staffId]/photo — multipart photo upload.
 *
 * ── The student route, with one table changed ────────────────────────────
 * `app/api/school/students/[studentId]/photo/route.ts` is the model and this
 * is deliberately its twin: same 2 MB cap, same three content types, same
 * `uploadBuffer`, same path shape under the school's own prefix. Inventing a
 * second upload posture would be inventing a second place for the tenant
 * prefix to be got wrong, and the tenant prefix is the whole security story
 * here.
 *
 * Uploads run through the server rather than the browser for that reason: the
 * object path is decided here from verified claims instead of being trusted
 * from the client, so a photograph can only ever land inside its own school's
 * prefix. The Supabase service-role key never leaves the server, so no browser
 * can write to Storage directly at all.
 *
 * ── Gated on `hr.write`, shown on `hr.read` ──────────────────────────────
 * The same permission that already lets somebody edit the record. A personnel
 * photograph is part of the personnel file and not a separate kind of secret,
 * so it needs no new key — which also means the `role_permissions` CHECK is
 * untouched (STATE.md §5o).
 *
 * ── Not `school_users.avatar_url` ────────────────────────────────────────
 * That is the sign-in account's picture. Writing a personnel photograph onto it
 * would mean an HR clerk changing somebody's login identity. Different fact,
 * different column.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ staffId: string }> };

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { staffId } = await context.params;
      if (!isUuid(staffId)) return apiFailure('not_found', 'Staff member not found.', 404);

      // Read against the session's tenant before anything is uploaded: an id
      // from another school must not decide a storage path in this one's name.
      const member = await getStaff(auth.locationId, staffId);
      if (member === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      if (auth.branchId !== null && member.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const form = await request.formData();
      const file = form.get('photo');

      if (!(file instanceof File)) {
        return apiFailure('invalid_body', 'Attach an image as "photo".', 400);
      }
      if (file.size === 0) {
        return apiFailure('invalid_body', 'The uploaded file is empty.', 400);
      }
      if (file.size > MAX_BYTES) {
        return apiFailure('file_too_large', 'The photo must be 2 MB or smaller.', 413);
      }

      const extension = ALLOWED_TYPES[file.type];
      if (extension === undefined) {
        return apiFailure(
          'unsupported_type',
          'The photo must be a PNG, JPG or WebP image.',
          415,
        );
      }

      const { downloadUrl } = await uploadBuffer({
        storagePath: `${auth.locationId}/staff/${staffId}/photo.${extension}`,
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
      });

      await db
        .update(staff)
        .set({ photoUrl: downloadUrl, updatedAt: new Date() })
        .where(and(eq(staff.id, staffId), eq(staff.locationId, auth.locationId)));

      return apiSuccess({ photoUrl: downloadUrl });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
