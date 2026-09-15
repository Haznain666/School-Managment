import { and, eq } from 'drizzle-orm';

import { vicePrincipalPrincipals } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { loadKpiContext } from '@/lib/kpi-access';
import { buildSetup } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';

/**
 * PUT /api/school/kpis/vice-principals — Sprint 32, rule 7c.
 *
 * Which principal a vice principal serves, at a school with several. A null
 * principal removes the link, and the deputy then reaches no teachers until
 * one is set — which the rating screen says in so many words.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<{ vicePrincipalUserId?: unknown; principalUserId?: unknown }>(
        request,
      );
      if (body === null || !isUuid(body.vicePrincipalUserId)) {
        return apiFailure('invalid_body', 'Choose a vice principal.', 400);
      }

      const ctx = await loadKpiContext(auth.locationId, auth);
      const deputy = ctx.byId.get(body.vicePrincipalUserId);
      if (deputy === undefined || deputy.role !== 'vice_principal') {
        return apiFailure('not_found', 'That vice principal does not exist.', 404);
      }

      if (body.principalUserId === null) {
        await db
          .delete(vicePrincipalPrincipals)
          .where(
            and(
              eq(vicePrincipalPrincipals.locationId, auth.locationId),
              eq(vicePrincipalPrincipals.vicePrincipalUserId, deputy.userId),
            ),
          );
      } else {
        const principal = isUuid(body.principalUserId) ? ctx.byId.get(body.principalUserId) : undefined;
        if (principal === undefined || principal.role !== 'principal') {
          return apiFailure('invalid_body', 'Choose one of the school’s principals.', 400);
        }

        await db
          .insert(vicePrincipalPrincipals)
          .values({
            locationId: auth.locationId,
            vicePrincipalUserId: deputy.userId,
            principalUserId: principal.userId,
            setBy: ctx.caller.userId,
          })
          .onConflictDoUpdate({
            target: vicePrincipalPrincipals.vicePrincipalUserId,
            set: { principalUserId: principal.userId, setBy: ctx.caller.userId },
          });
      }

      const fresh = await loadKpiContext(auth.locationId, auth);
      return apiSuccess({ setup: await buildSetup(fresh) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'permissions.manage', module: 'staff_kpis' },
);
