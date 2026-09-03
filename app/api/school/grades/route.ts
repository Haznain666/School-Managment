import { and, eq } from 'drizzle-orm';

import { branches, grades } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { listGrades } from '@/lib/admissions-queries';
import { db } from '@/lib/drizzle';
import { getGradesForCurriculum } from '@/lib/predefined-grades';
import { visibleScopeFor } from '@/lib/principal-visibility';
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

      /*
       * BR4 — Sprint 23, item 3. This route is the feeder for almost every
       * grade picker in the product: the enrolment wizard's placement step, the
       * students filter bar, the grade setup grid, the section picker's parent.
       * Narrowing it here narrows all of them at once, from the session rather
       * than from anything the browser sends.
       *
       * A **visibility filter, not an authorization boundary**: a head who
       * posts a grade id outside their scope to a write route is still
       * obeyed. That is `SPRINT-23-SPEC.md` §3's recorded decision, and the
       * consequence is deliberate.
       *
       * `null` is "every grade" and is what every non-principal gets, without a
       * query. An **empty list** is a head with no assignment and means no
       * grades, which is why the two are not collapsed with `?? []`.
       */
      const visible = await visibleScopeFor(auth);
      const rows = await listGrades(auth.locationId, branchId ?? undefined);

      return apiSuccess({
        grades:
          visible.gradeIds === null
            ? rows
            : rows.filter((row) => visible.gradeIds?.includes(row.id) ?? false),
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
