import { eq } from 'drizzle-orm';

import { studentImportBatches } from '@/db/schema';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { withSchoolAuth } from '@/lib/api-auth';
import { db } from '@/lib/drizzle';
import {
  commitBatch,
  countRowOutcomes,
  getImportBatch,
  resolveBatchTarget,
} from '@/lib/student-import-queries';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/student-imports/[batchId]/commit — write the students.
 *
 * ── Committing twice ────────────────────────────────────────────────────
 * The batch's status is the guard: it moves to `committed` when this finishes
 * and a second call is refused. That covers the operator pressing the button
 * twice on a slow connection, which is the likely way it happens.
 *
 * The other way an import runs twice is the same file uploaded again next week.
 * That is caught a layer down, by matching on admission number during
 * validation, and comes back as `skipped` rather than a second Ayesha Khan.
 * Both are needed — the status alone would not stop a re-upload, and the
 * matching alone would not stop a double click.
 *
 * A batch that has not been validated cannot be committed. The dry run is not
 * advisory: it is what decides which rows are written.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ batchId: string }> };

export const POST = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { batchId } = await context.params;
      if (!isUuid(batchId)) return apiFailure('not_found', 'Import not found.', 404);

      const batch = await getImportBatch(auth.locationId, batchId);
      if (batch === null) return apiFailure('not_found', 'Import not found.', 404);

      if (batch.status === 'committed') {
        return apiFailure(
          'conflict',
          'This import has already been run — nothing was imported twice.',
          409,
        );
      }
      if (batch.status !== 'validated') {
        return apiFailure(
          'conflict',
          'Map the columns and check the file before importing.',
          409,
        );
      }

      if (batch.sectionId === null) {
        return apiFailure('conflict', 'This import has no class to load into.', 409);
      }

      const target = await resolveBatchTarget(auth.locationId, batch.sectionId);
      if (target === null) {
        return apiFailure(
          'conflict',
          'The class this import was set up for no longer exists. Start the import again.',
          409,
        );
      }

      if (auth.branchId !== null && target.branchId !== auth.branchId) {
        return apiFailure('not_found', 'Import not found.', 404);
      }

      const summary = await commitBatch(batch, target, auth.uid);

      await db
        .update(studentImportBatches)
        .set({
          status: 'committed',
          createdRows: summary.created,
          failedRows: summary.failed,
          committedAt: new Date(),
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
