import { and, eq } from 'drizzle-orm';

import { principalAssignments } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
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
        .select({ startsOn: principalAssignments.startsOn })
        .from(principalAssignments)
        .where(
          and(
            eq(principalAssignments.locationId, auth.locationId),
            eq(principalAssignments.id, assignmentId),
          ),
        )
        .limit(1);

      if (existing[0] === undefined) {
        return apiFailure('not_found', 'No such assignment.', 404);
      }
      if (endsOn !== null && endsOn < existing[0].startsOn) {
        return apiFailure('invalid_body', 'An assignment cannot end before it starts.', 400);
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
