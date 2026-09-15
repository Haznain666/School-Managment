import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildBoard } from '@/lib/kpi-board';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * GET /api/school/kpis/performance?month=YYYY-MM — Sprint 32.
 *
 * The Staff performance board for one month: the same `buildBoard` the page
 * renders, so switching month on a hard-loaded page and reloading it give one
 * answer. Rows the caller may see only as a yearly overall come back without
 * a monthly figure at all, rather than with one the screen hides.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const ctx = await loadKpiContext(auth.locationId, auth);
      if (!ctx.permissions.has('kpis.read') && !ctx.permissions.has('kpis.overall')) {
        return apiFailure('forbidden', 'Your role does not see staff scores.', 403);
      }

      const month = new URL(request.url).searchParams.get('month');
      return apiSuccess({ board: await buildBoard(ctx, month) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES, module: 'staff_kpis' },
);
