import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { deleteOwnPlan } from '@/lib/lesson-plan-queries';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';
import { USER_ROLES } from '@/types/school-auth';

/**
 * /api/school/lesson-plans/[planId] — DELETE one of my own.
 *
 * There is no PATCH. A plan is identified by (teacher, section, subject, week),
 * and POST upserts on exactly that key — so editing is saving the same week
 * again, and a second verb would be a second way to write the same row.
 *
 * The teacher id goes into the `WHERE` rather than being checked first: a plan
 * belonging to a colleague matches no row and gets the same 404 a made-up id
 * gets, which is both correct and free of the race a check-then-act would have.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ planId: string }>;
}

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { planId } = await context.params;
      if (!isUuid(planId)) {
        return apiFailure('invalid_query', 'That is not a lesson plan.', 400);
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      if (me === null) {
        return apiFailure('not_found', 'No account at this school.', 404);
      }

      if (!(await deleteOwnPlan(auth.locationId, me.id, planId))) {
        return apiFailure('not_found', 'No such lesson plan of yours.', 404);
      }

      return apiSuccess({ id: planId });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: USER_ROLES.filter((role) => role !== 'student' && role !== 'parent') },
);
