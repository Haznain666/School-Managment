import { staffKpis } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { branchForWrite, resolveBranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { listKpis } from '@/lib/kpi-access';
import {
  MAX_KPI_DESCRIPTION_LENGTH,
  definableTargets,
  isKpiPeriod,
  isKpiTargetRole,
  kpiNameProblem,
} from '@/lib/kpis';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { ROLE_LABELS } from '@/types/school-auth';

/**
 * /api/school/kpis — Sprint 32.
 *
 * GET  the live KPIs in the caller's campus scope
 * POST define one
 *
 * ── The response carries the list ────────────────────────────────────────
 * A save answers with the whole list, read through the same `listKpis` the
 * page renders with, and the screen replaces its rows from it. Nothing waits on
 * `router.refresh()`, which does nothing on a page the browser hard-loaded
 * (§5ca) — and a principal opens this screen from a bookmark every month.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const scope = await resolveBranchScope(auth.locationId, auth);
      return apiSuccess({ kpis: await listKpis(auth.locationId, scope.branchIds) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'kpis.read', module: 'staff_kpis' },
);

interface KpiBody {
  name?: unknown;
  description?: unknown;
  targetRole?: unknown;
  period?: unknown;
  branchId?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<KpiBody>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const nameProblem = kpiNameProblem(name);
      if (nameProblem !== null) return apiFailure('invalid_body', nameProblem, 400);

      const description =
        typeof body.description === 'string' && body.description.trim() !== ''
          ? body.description.trim()
          : null;
      if (description !== null && description.length > MAX_KPI_DESCRIPTION_LENGTH) {
        return apiFailure(
          'invalid_body',
          `Keep the description to ${String(MAX_KPI_DESCRIPTION_LENGTH)} characters.`,
          400,
        );
      }

      if (!isKpiTargetRole(body.targetRole)) {
        return apiFailure('invalid_body', 'Choose the role this KPI is for.', 400);
      }
      if (!isKpiPeriod(body.period)) {
        return apiFailure('invalid_body', 'Choose Monthly or Annual.', 400);
      }

      // Rule 3, on the server. The dropdown offers only these; this is the rule.
      if (!definableTargets(auth.role).includes(body.targetRole)) {
        return apiFailure(
          'forbidden',
          `Your role cannot define KPIs for ${ROLE_LABELS[body.targetRole]}.`,
          403,
        );
      }

      const scope = await resolveBranchScope(auth.locationId, auth);
      const requested = typeof body.branchId === 'string' && body.branchId !== '' ? body.branchId : null;
      const branch = branchForWrite(scope, requested);
      if (!branch.ok) return apiFailure('forbidden', branch.message, 403);

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);

      await db.insert(staffKpis).values({
        locationId: auth.locationId,
        branchId: branch.branchId,
        targetRole: body.targetRole,
        name,
        description,
        period: body.period,
        createdBy: me?.id ?? null,
        updatedBy: me?.id ?? null,
      });

      return apiSuccess({ kpis: await listKpis(auth.locationId, scope.branchIds) }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'kpis.create', module: 'staff_kpis' },
);
