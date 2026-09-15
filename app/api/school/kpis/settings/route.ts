import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { getKpiSettings, saveKpiSettings } from '@/lib/kpi-access';
import { parseKpiSettings } from '@/lib/kpis';
import { getSchoolUserByUid } from '@/lib/school-queries';

/**
 * /api/school/kpis/settings — Sprint 32, rule 7.
 *
 * *Mark principals' progress?* and *Mark branch admins' progress?*, with who
 * rates each. Gated on `permissions.manage`, which the School Administrator
 * always keeps: these two settings are the part of the who-rates-whom grid that
 * is not a permission key, and they belong with whoever owns the grid.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      return apiSuccess({ settings: await getKpiSettings(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage', module: 'staff_kpis' },
);

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const parsed = parseKpiSettings(await readJsonBody<unknown>(request));
      if (typeof parsed === 'string') return apiFailure('invalid_body', parsed, 400);

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);
      await saveKpiSettings(auth.locationId, parsed, me?.id ?? null);

      return apiSuccess({ settings: await getKpiSettings(auth.locationId) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage', module: 'staff_kpis' },
);
