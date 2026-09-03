import { and, eq } from 'drizzle-orm';

import { principalAssignments } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { listGrades } from '@/lib/admissions-queries';
import {
  claimedGrades,
  getPrincipalSettings,
  gradeClashProblem,
} from '@/lib/principal-resolver';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/principals/[assignmentId]
 *
 * PATCH  end an assignment, or reopen one ended by mistake
 * DELETE remove one entirely
 *
 * ── Ending is the ordinary act; deleting is the correction ───────────────
 * A head leaving the post is an *end date*, not a deletion: the row is what
 * answers "who ran the O-Levels last year", and a school gets asked. DELETE
 * exists for the row that should never have been written — a typo, the wrong
 * person — and the screen labels the two differently for that reason.
 *
 * Both scope every statement on `location_id` from the verified session as well
 * as the id, so an assignment id from another tenant matches nothing rather
 * than being ended in this school's name.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ assignmentId: string }>;
}

interface PatchBody {
  endsOn?: unknown;
}

/** Today, in the form the `date` columns hold. Same rule as the resolver's. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { assignmentId } = await context.params;
      if (!isUuid(assignmentId)) {
        return apiFailure('invalid_query', 'That is not an assignment.', 400);
      }

      const body = await readJsonBody<PatchBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      // Null is meaningful here and is how an assignment is reopened, so an
      // absent key and an explicit null must not be read the same way.
      const endsOn = readOptionalString(body.endsOn);
      if (endsOn !== null && !isIsoDate(endsOn)) {
        return apiFailure('invalid_body', 'That end date is not a date.', 400);
      }

      const existing = await db
        .select({
          startsOn: principalAssignments.startsOn,
          endsOn: principalAssignments.endsOn,
          schoolUserId: principalAssignments.schoolUserId,
          gradeIds: principalAssignments.gradeIds,
        })
        .from(principalAssignments)
        .where(
          and(
            eq(principalAssignments.locationId, auth.locationId),
            eq(principalAssignments.id, assignmentId),
          ),
        )
        .limit(1);

      const assignment = existing[0];
      if (assignment === undefined) {
        return apiFailure('not_found', 'No such assignment.', 404);
      }
      if (endsOn !== null && endsOn < assignment.startsOn) {
        return apiFailure('invalid_body', 'An assignment cannot end before it starts.', 400);
      }

      /*
       * Sprint 23, item 2. Reopening is the only way this route can create an
       * overlap — ending one never can — so the clash is checked exactly when
       * the row is being put *back* into force and its grades are not already
       * claimed by it.
       *
       * `claimedGrades` reads the window as it stands *before* this update, so
       * an assignment that is currently ended is absent from the claims and
       * cannot clash with itself; `gradeClashProblem` excludes it by id in any
       * case, for the row that is already in force and merely being re-dated.
       */
      const reopening =
        assignment.gradeIds.length > 0 &&
        assignment.startsOn <= todayIso() &&
        (endsOn === null || endsOn >= todayIso());

      if (reopening) {
        const { allowSharedGrades } = await getPrincipalSettings(auth.locationId);
        if (!allowSharedGrades) {
          const ladder = await listGrades(auth.locationId);
          const problem = gradeClashProblem(await claimedGrades(auth.locationId), {
            gradeIds: assignment.gradeIds,
            schoolUserId: assignment.schoolUserId,
            assignmentId,
            gradeNames: new Map(ladder.map((row) => [row.id, row.label])),
          });
          if (problem !== null) return apiFailure('grade_already_assigned', problem, 409);
        }
      }

      await db
        .update(principalAssignments)
        .set({ endsOn, updatedAt: new Date() })
        .where(
          and(
            eq(principalAssignments.locationId, auth.locationId),
            eq(principalAssignments.id, assignmentId),
          ),
        );

      return apiSuccess({ id: assignmentId, endsOn });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'principals.manage' },
);

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { assignmentId } = await context.params;
      if (!isUuid(assignmentId)) {
        return apiFailure('invalid_query', 'That is not an assignment.', 400);
      }

      const removed = await db
        .delete(principalAssignments)
        .where(
          and(
            eq(principalAssignments.locationId, auth.locationId),
            eq(principalAssignments.id, assignmentId),
          ),
        )
        .returning({ id: principalAssignments.id });

      if (removed.length === 0) {
        return apiFailure('not_found', 'No such assignment.', 404);
      }

      return apiSuccess({ id: assignmentId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'principals.manage' },
);
