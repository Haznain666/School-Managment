import { and, eq } from 'drizzle-orm';

import { teacherPrincipalTransfers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { loadKpiContext, setTeacherPrincipal } from '@/lib/kpi-access';
import { buildSetup } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';

/**
 * POST /api/school/kpis/principals/assign — Sprint 32.
 *
 * The School Administrator decides a teacher's principal outright: a tie on
 * "teaches most", a teacher with no periods and no class, or a request about
 * an unassigned teacher. Stored as `assigned`, which a later timetable change
 * does not undo — the same standing a transfer has. Any open request for the
 * teacher is cancelled, because it asked a question that has now been answered.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<{ teacherUserId?: unknown; principalUserId?: unknown }>(request);
      if (body === null || !isUuid(body.teacherUserId) || !isUuid(body.principalUserId)) {
        return apiFailure('invalid_body', 'Choose a teacher and a principal.', 400);
      }

      const ctx = await loadKpiContext(auth.locationId, auth);
      if (ctx.model !== 'multiple') {
        return apiFailure('invalid_body', 'Your school runs one principal.', 400);
      }

      const teacher = ctx.byId.get(body.teacherUserId);
      const principal = ctx.byId.get(body.principalUserId);
      if (teacher === undefined || teacher.role !== 'teacher') {
        return apiFailure('not_found', 'That teacher does not exist.', 404);
      }
      if (principal === undefined || principal.role !== 'principal') {
        return apiFailure('invalid_body', 'Choose one of the school’s principals.', 400);
      }

      await setTeacherPrincipal(auth.locationId, teacher.userId, principal.userId, 'assigned', ctx.caller.userId);

      await db
        .update(teacherPrincipalTransfers)
        .set({ status: 'cancelled', decidedBy: ctx.caller.userId, decidedAt: new Date() })
        .where(
          and(
            eq(teacherPrincipalTransfers.locationId, auth.locationId),
            eq(teacherPrincipalTransfers.teacherUserId, teacher.userId),
            eq(teacherPrincipalTransfers.status, 'requested'),
          ),
        );

      const fresh = await loadKpiContext(auth.locationId, auth);
      return apiSuccess({ setup: await buildSetup(fresh) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage', module: 'staff_kpis' },
);
