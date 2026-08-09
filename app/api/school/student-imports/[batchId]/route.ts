import { eq } from 'drizzle-orm';

import { studentImportBatches, type ImportRowOutcome } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import {
  countRowOutcomes,
  getImportBatch,
  listImportRows,
  resolveBatchTarget,
  validateBatch,
} from '@/lib/student-import-queries';
import { REQUIRED_FIELDS } from '@/lib/student-import';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/student-imports/[batchId]
 *
 * GET    the batch and its report, one outcome at a time
 * PATCH  set the mapping and the target section, then run the dry run
 * DELETE cancel the batch
 *
 * PATCH is where the dry run happens, and it is deliberately not a separate
 * endpoint: mapping and validating are one action from the operator's side —
 * "here is what my columns mean, tell me what is wrong" — and splitting them
 * would allow a batch whose stored map and stored verdict were computed from
 * different inputs.
 *
 * A committed batch is read-only. Re-mapping one would leave a report
 * describing a decision that has already been carried out.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ batchId: string }> };

const OUTCOMES: readonly ImportRowOutcome[] = [
  'pending',
  'invalid',
  'created',
  'skipped',
  'failed',
];

export const GET = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { batchId } = await context.params;
      if (!isUuid(batchId)) return apiFailure('not_found', 'Import not found.', 404);

      const batch = await getImportBatch(auth.locationId, batchId);
      if (batch === null) return apiFailure('not_found', 'Import not found.', 404);

      const url = new URL(request.url);
      const outcomeParam = url.searchParams.get('outcome');
      const outcome = OUTCOMES.find((value) => value === outcomeParam);

      const pageRaw = Number.parseInt(url.searchParams.get('page') ?? '1', 10);

      const [rows, counts] = await Promise.all([
        listImportRows(batchId, {
          outcome,
          page: Number.isFinite(pageRaw) ? pageRaw : 1,
        }),
        countRowOutcomes(batchId),
      ]);

      return apiSuccess({ batch, counts, ...rows });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.import' },
);

interface PatchBody {
  columnMap?: unknown;
  sectionId?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { batchId } = await context.params;
      if (!isUuid(batchId)) return apiFailure('not_found', 'Import not found.', 404);

      const batch = await getImportBatch(auth.locationId, batchId);
      if (batch === null) return apiFailure('not_found', 'Import not found.', 404);

      if (batch.status === 'committed') {
        return apiFailure(
          'conflict',
          'This import has already been run. Upload the file again to import more students.',
          409,
        );
      }
      if (batch.status === 'cancelled') {
        return apiFailure('conflict', 'This import was cancelled.', 409);
      }

      const body = await readJsonBody<PatchBody>(request);
      if (body === null || typeof body.columnMap !== 'object' || body.columnMap === null) {
        return apiFailure('invalid_body', 'Expected { columnMap, sectionId }.', 400);
      }

      // Only string-to-string pairs survive, and only for columns the file
      // actually has: a map naming a column that is not in the file would
      // validate every row as missing that field, which reads as a broken
      // importer rather than a bad mapping.
      const columnMap: Record<string, string> = {};
      for (const [field, column] of Object.entries(body.columnMap)) {
        if (typeof column === 'string' && batch.sourceColumns.includes(column)) {
          columnMap[field] = column;
        }
      }

      const missing = REQUIRED_FIELDS.filter((field) => columnMap[field.key] === undefined);
      if (missing.length > 0) {
        return apiFailure(
          'invalid_body',
          `Map a column for: ${missing.map((field) => field.label).join(', ')}.`,
          400,
        );
      }

      const sectionId = typeof body.sectionId === 'string' ? body.sectionId : '';
      if (!isUuid(sectionId)) {
        return apiFailure('invalid_body', 'Choose the class these students join.', 400);
      }

      // Re-read through a tenant-filtered query: a section id from another
      // school satisfies the foreign key perfectly well.
      const target = await resolveBatchTarget(auth.locationId, sectionId);
      if (target === null) {
        return apiFailure('invalid_body', 'That class does not exist.', 400);
      }

      // A branch-scoped admin cannot load students into another campus.
      if (auth.branchId !== null && target.branchId !== auth.branchId) {
        return apiFailure('invalid_body', 'That class does not exist.', 400);
      }

      const summary = await validateBatch(batch, columnMap);

      await db
        .update(studentImportBatches)
        .set({
          columnMap,
          sectionId: target.sectionId,
          academicYearId: target.academicYearId,
          status: 'validated',
          validRows: summary.valid,
          invalidRows: summary.invalid,
          skippedRows: summary.duplicate,
          validatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(studentImportBatches.id, batchId));

      return apiSuccess({
        summary,
        target,
        counts: await countRowOutcomes(batchId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.import' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { batchId } = await context.params;
      if (!isUuid(batchId)) return apiFailure('not_found', 'Import not found.', 404);

      const batch = await getImportBatch(auth.locationId, batchId);
      if (batch === null) return apiFailure('not_found', 'Import not found.', 404);

      if (batch.status === 'committed') {
        return apiFailure(
          'conflict',
          'This import has already created students. Cancelling it would not remove them — delete them from the student list instead.',
          409,
        );
      }

      // Cancelled, not deleted: the batch is the record that somebody uploaded
      // a file and thought better of it, which is worth keeping.
      await db
        .update(studentImportBatches)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(studentImportBatches.id, batchId));

      return apiSuccess({ cancelled: true });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'students.import' },
);
