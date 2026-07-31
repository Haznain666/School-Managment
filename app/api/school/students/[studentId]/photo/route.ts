import { and, eq } from 'drizzle-orm';

import { studentProfiles } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getStudentDetail } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { uploadBuffer } from '@/lib/storage';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/students/[studentId]/photo — multipart photo upload.
 *
 * Uploads run through the server rather than the browser's Firebase SDK for the
 * same reason the logo upload does: the Admin SDK writes a stable download
 * token, and the object path is decided here instead of being trusted from the
 * client. The leading `{locationId}` segment is what `storage.rules` matches
 * on, so a photo can only ever land inside its own school's prefix.
 *
 * Called after the student exists, because the path is keyed by their record.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string }> };

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
      const { studentId } = await context.params;
      if (!isUuid(studentId)) return apiFailure('not_found', 'Student not found.', 404);

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) return apiFailure('not_found', 'Student not found.', 404);

      if (auth.branchId !== null && student.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Student not found.', 404);
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
        storagePath: `${auth.locationId}/students/${studentId}/photo.${extension}`,
        buffer: Buffer.from(await file.arrayBuffer()),
        contentType: file.type,
        metadata: { uploadedBy: auth.uid, studentId: student.studentId },
      });

      await db
        .update(studentProfiles)
        .set({ photoUrl: downloadUrl, updatedAt: new Date() })
        .where(
          and(
            eq(studentProfiles.id, studentId),
            eq(studentProfiles.locationId, auth.locationId),
          ),
        );

      return apiSuccess({ photoUrl: downloadUrl });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ['school_admin', 'branch_admin'] },
);
