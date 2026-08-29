import { and, eq } from 'drizzle-orm';

import { studentDocuments } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getStudentDetail, getStudentDocument } from '@/lib/admissions-queries';
import { effectiveBranchIds, resolveBranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { deleteObject } from '@/lib/storage';
import { isUuid } from '@/lib/validation';

/**
 * DELETE /api/school/students/[studentId]/documents/[documentId]
 *
 * ── Row first, then the object ──────────────────────────────────────────
 * The opposite order of the upload, and for the same reason: whichever half
 * fails, the survivor must be the harmless one. Deleting the row first means a
 * Storage failure leaves an *orphaned object* — invisible, referenced by
 * nothing, costing a few kilobytes. Deleting the object first would leave a row
 * whose chip opens a 404, which an operator cannot tell from a deletion that
 * did not happen.
 *
 * `deleteObject` already treats a missing object as success, so re-running this
 * after a partial failure converges rather than erroring.
 *
 * ── Both ids are checked, and the pairing between them ──────────────────
 * `getStudentDocument` matches on tenant **and** student **and** document.
 * Matching on the document alone would let a correctly-formed id delete another
 * child's paperwork from a URL built by hand — and the two children could be at
 * two different campuses.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ studentId: string; documentId: string }> };

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { studentId, documentId } = await context.params;
      if (!isUuid(studentId) || !isUuid(documentId)) {
        return apiFailure('not_found', 'Document not found.', 404);
      }

      const student = await getStudentDetail(auth.locationId, studentId);
      if (student === null) {
        return apiFailure('not_found', 'Document not found.', 404);
      }

      // The campus boundary, resolved rather than read off the claim. 404 and
      // not 403: "you may not see this" confirms it exists.
      const scope = await resolveBranchScope(auth.locationId, auth);
      const reachable = effectiveBranchIds(scope);
      if (
        reachable !== null &&
        student.branchId !== null &&
        !reachable.includes(student.branchId)
      ) {
        return apiFailure('not_found', 'Document not found.', 404);
      }

      const document = await getStudentDocument(auth.locationId, studentId, documentId);
      if (document === null) {
        return apiFailure('not_found', 'Document not found.', 404);
      }

      await db
        .delete(studentDocuments)
        .where(
          and(
            eq(studentDocuments.id, documentId),
            eq(studentDocuments.locationId, auth.locationId),
          ),
        );

      await deleteObject(document.storagePath);

      return apiSuccess({ deleted: document.title });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.update' },
);
