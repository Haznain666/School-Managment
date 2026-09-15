import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildPersonSheet } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/kpis/people/[userId]?month=YYYY-MM — Sprint 32.
 *
 * One person's sheet. `me` names the caller, which is how a teacher reads
 * their own scores without an id anywhere in the request. Somebody outside the
 * caller's reach is a 404, not a 403: whether a colleague is rated at all is
 * not the caller's business either.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ userId: string }> };

export const GET = withSchoolAuth<Context>(
  async (request, auth, context) => {
    try {
      const { userId } = await context.params;
      const ctx = await loadKpiContext(auth.locationId, auth);

      const id = userId === 'me' ? ctx.caller.userId : userId;
      const target = id !== null && isUuid(id) ? ctx.byId.get(id) : undefined;
      const month = new URL(request.url).searchParams.get('month');

      const sheet = target === undefined ? null : await buildPersonSheet(ctx, target, month);
      if (sheet === null) {
        return apiFailure('not_found', 'That person is not in your reach.', 404);
      }

      return apiSuccess({ sheet });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: [...ADMIN_PORTAL_ROLES, 'teacher'], module: 'staff_kpis' },
);
