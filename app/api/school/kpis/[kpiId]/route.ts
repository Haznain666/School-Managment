import { and, count, eq, isNull } from 'drizzle-orm';
import type { NextResponse } from 'next/server';

import { staffKpiRatings, staffKpis } from '@/db/schema';
import { withSchoolAuth, type SchoolAuthContext } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { resolveBranchScope, scopeAdmitsWrite, type BranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { getKpi, listKpis } from '@/lib/kpi-access';
import {
  MAX_KPI_DESCRIPTION_LENGTH,
  definableTargets,
  isKpiPeriod,
  isKpiTargetRole,
  kpiNameProblem,
} from '@/lib/kpis';
import { getSchoolUserByUid } from '@/lib/school-queries';
import { isUuid } from '@/lib/validation';
import { ROLE_LABELS } from '@/types/school-auth';

/**
 * /api/school/kpis/[kpiId] — Sprint 32.
 *
 * PATCH edit a KPI      (`kpis.create`)
 * DELETE delete it     (`kpis.delete`) — a soft delete; ratings are kept
 *
 * ── Role and period are fixed once somebody has been rated ───────────────
 * A rating of 8 on a monthly *Punctuality* for teachers means something only
 * while the KPI is still monthly and still for teachers. The name and the
 * description can always be corrected; the two facts a score was entered
 * against cannot be changed underneath it.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ kpiId: string }> };

type Loaded =
  | { ok: true; kpi: NonNullable<Awaited<ReturnType<typeof getKpi>>>; scope: BranchScope }
  | { ok: false; response: NextResponse };

async function loadForChange(auth: SchoolAuthContext, kpiId: string): Promise<Loaded> {
  if (!isUuid(kpiId)) {
    return { ok: false, response: apiFailure('not_found', 'That KPI does not exist.', 404) };
  }

  const kpi = await getKpi(auth.locationId, kpiId);
  if (kpi === null) {
    return { ok: false, response: apiFailure('not_found', 'That KPI does not exist.', 404) };
  }

  if (!definableTargets(auth.role).includes(kpi.targetRole)) {
    return {
      ok: false,
      response: apiFailure(
        'forbidden',
        `Your role cannot change KPIs for ${ROLE_LABELS[kpi.targetRole]}.`,
        403,
      ),
    };
  }

  const scope = await resolveBranchScope(auth.locationId, auth);
  if (!scopeAdmitsWrite(scope, kpi.branchId)) {
    return {
      ok: false,
      response: apiFailure(
        'forbidden',
        kpi.branchId === null
          ? 'This KPI is shared by every campus, so only a school-wide administrator can change it.'
          : 'This KPI belongs to a campus you do not have access to.',
        403,
      ),
    };
  }

  return { ok: true, kpi, scope };
}

export const PATCH = withSchoolAuth<Context>(
  async (request, auth, context) => {
    try {
      const { kpiId } = await context.params;
      const loaded = await loadForChange(auth, kpiId);
      if (!loaded.ok) return loaded.response;

      const body = await readJsonBody<Record<string, unknown>>(request);
      if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

      const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
      const nameProblem = kpiNameProblem(name);
      if (nameProblem !== null) return apiFailure('invalid_body', nameProblem, 400);

      const description =
        typeof body['description'] === 'string' && body['description'].trim() !== ''
          ? body['description'].trim()
          : null;
      if (description !== null && description.length > MAX_KPI_DESCRIPTION_LENGTH) {
        return apiFailure(
          'invalid_body',
          `Keep the description to ${String(MAX_KPI_DESCRIPTION_LENGTH)} characters.`,
          400,
        );
      }

      const targetRole = body['targetRole'];
      const period = body['period'];
      if (!isKpiTargetRole(targetRole) || !isKpiPeriod(period)) {
        return apiFailure('invalid_body', 'Choose a role and a period.', 400);
      }
      if (!definableTargets(auth.role).includes(targetRole)) {
        return apiFailure(
          'forbidden',
          `Your role cannot define KPIs for ${ROLE_LABELS[targetRole]}.`,
          403,
        );
      }

      if (targetRole !== loaded.kpi.targetRole || period !== loaded.kpi.period) {
        const [rated] = await db
          .select({ n: count() })
          .from(staffKpiRatings)
          .where(
            and(
              eq(staffKpiRatings.locationId, auth.locationId),
              eq(staffKpiRatings.kpiId, loaded.kpi.id),
            ),
          );
        if (Number(rated?.n ?? 0) > 0) {
          return apiFailure(
            'conflict',
            'Somebody has already been rated on this KPI, so its role and period can no longer change. Create a new KPI instead.',
            409,
          );
        }
      }

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);

      await db
        .update(staffKpis)
        .set({ name, description, targetRole, period, updatedBy: me?.id ?? null, updatedAt: new Date() })
        .where(
          and(
            eq(staffKpis.locationId, auth.locationId),
            eq(staffKpis.id, loaded.kpi.id),
            isNull(staffKpis.deletedAt),
          ),
        );

      return apiSuccess({ kpis: await listKpis(auth.locationId, loaded.scope.branchIds) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'kpis.create', module: 'staff_kpis' },
);

export const DELETE = withSchoolAuth<Context>(
  async (_request, auth, context) => {
    try {
      const { kpiId } = await context.params;
      const loaded = await loadForChange(auth, kpiId);
      if (!loaded.ok) return loaded.response;

      const me = await getSchoolUserByUid(auth.locationId, auth.uid);

      await db
        .update(staffKpis)
        .set({ deletedAt: new Date(), deletedBy: me?.id ?? null })
        .where(
          and(
            eq(staffKpis.locationId, auth.locationId),
            eq(staffKpis.id, loaded.kpi.id),
            isNull(staffKpis.deletedAt),
          ),
        );

      return apiSuccess({ kpis: await listKpis(auth.locationId, loaded.scope.branchIds) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'kpis.delete', module: 'staff_kpis' },
);
