import { and, eq } from 'drizzle-orm';

import { teacherPrincipalTransfers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { loadKpiContext, setTeacherPrincipal } from '@/lib/kpi-access';
import { buildSetup, canDecideTransfer } from '@/lib/kpi-board';
import { isUuid } from '@/lib/validation';
import { ADMIN_PORTAL_ROLES } from '@/types/school-auth';

/**
 * PATCH /api/school/kpis/principals/transfers/[transferId] — Sprint 32.
 *
 * `accepted` / `declined` by the other principal (or the School Admin);
 * `cancelled` by whoever asked. Claimed with a conditional `UPDATE … RETURNING`
 * on `status = 'requested'`, so two principals clicking at once decide it once.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ transferId: string }> };

const DECISIONS = ['accepted', 'declined', 'cancelled'] as const;
type Decision = (typeof DECISIONS)[number];

export const PATCH = withSchoolAuth<Context>(
  async (request, auth, context) => {
    try {
      const { transferId } = await context.params;
      if (!isUuid(transferId)) return apiFailure('not_found', 'That request does not exist.', 404);

      const body = await readJsonBody<{ decision?: unknown }>(request);
      const decision = body?.decision;
      if (typeof decision !== 'string' || !(DECISIONS as readonly string[]).includes(decision)) {
        return apiFailure('invalid_body', 'Accept, decline or cancel.', 400);
      }

      const [row] = await db
        .select()
        .from(teacherPrincipalTransfers)
        .where(
          and(
            eq(teacherPrincipalTransfers.locationId, auth.locationId),
            eq(teacherPrincipalTransfers.id, transferId),
          ),
        )
        .limit(1);
      if (row === undefined) return apiFailure('not_found', 'That request does not exist.', 404);

      const ctx = await loadKpiContext(auth.locationId, auth);

      const allowed =
        (decision as Decision) === 'cancelled'
          ? row.status === 'requested' &&
            (row.requestedBy === ctx.caller.userId ||
              (auth.role === 'school_admin' && ctx.permissions.has('permissions.manage')))
          : canDecideTransfer(ctx, row);

      if (!allowed) {
        return apiFailure(
          'forbidden',
          row.status === 'requested'
            ? 'This request is for the other principal to decide.'
            : 'This request has already been decided.',
          403,
        );
      }

      const claimed = await db
        .update(teacherPrincipalTransfers)
        .set({ status: decision as Decision, decidedBy: ctx.caller.userId, decidedAt: new Date() })
        .where(
          and(
            eq(teacherPrincipalTransfers.id, row.id),
            eq(teacherPrincipalTransfers.status, 'requested'),
          ),
        )
        .returning({ id: teacherPrincipalTransfers.id });

      if (claimed.length === 0) {
        return apiFailure('conflict', 'Somebody else decided this request a moment ago.', 409);
      }

      if (decision === 'accepted') {
        await setTeacherPrincipal(
          auth.locationId,
          row.teacherUserId,
          row.toPrincipalUserId,
          'transferred',
          row.requestedBy,
        );
      }

      const fresh = await loadKpiContext(auth.locationId, auth);
      return apiSuccess({ setup: await buildSetup(fresh) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: ADMIN_PORTAL_ROLES, module: 'staff_kpis' },
);
