import { and, eq } from 'drizzle-orm';

import { branches, grades } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listGrades } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { getGradesForCurriculum } from '@/lib/predefined-grades';
import { isUuid, readString } from '@/lib/validation';

/**
 * /api/school/grades
 *
 * GET  the grade ladder, optionally for one branch
 * POST seed a branch's ladder from the predefined list for its curriculum
 *
 * There is no free-form create: grades come from `lib/predefined-grades.ts`
 * (Sprint 4, Decision 1). A school renames them through
 * `PATCH /api/school/grades/[gradeId]`, and nothing else about them is editable.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);

      // A branch-scoped admin sees their own branch whatever they ask for.
      const requested = url.searchParams.get('branchId') ?? undefined;
      const branchId = auth.branchId ?? requested;

      return apiSuccess({
        grades: await listGrades(auth.locationId, branchId ?? undefined),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.read' },
);

interface SeedGradesBody {
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<SeedGradesBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const branchId = readString(body.branchId);
      if (!isUuid(branchId)) {
        return apiFailure('invalid_body', 'Select a branch.', 400);
      }

      if (auth.branchId !== null && auth.branchId !== branchId) {
        return apiFailure('forbidden', 'You can only set up your own branch.', 403);
      }

      // The branch must belong to this school — a UUID from another tenant
      // must not slip through the foreign key.
      const branchRows = await db
        .select({ id: branches.id, curriculumLevel: branches.curriculumLevel })
        .from(branches)
        .where(and(eq(branches.id, branchId), eq(branches.locationId, auth.locationId)))
        .limit(1);

      const branch = branchRows[0];
      if (branch === undefined) {
        return apiFailure('invalid_body', 'That branch does not exist.', 400);
      }

      const ladder = getGradesForCurriculum(branch.curriculumLevel);

      // Re-seeding is safe and idempotent: the unique key is
      // (branch_id, sort_order), so an existing rung is left exactly as it is —
      // including whatever display name the school gave it.
      const inserted = await db
        .insert(grades)
        .values(
          ladder.map((grade) => ({
            locationId: auth.locationId,
            branchId,
            name: grade.name,
            curriculumLevel: branch.curriculumLevel,
            sortOrder: grade.sortOrder,
          })),
        )
        .onConflictDoNothing({ target: [grades.branchId, grades.sortOrder] })
        .returning({ id: grades.id });

      return apiSuccess({ seeded: inserted.length, total: ladder.length }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'admissions.write' },
);
