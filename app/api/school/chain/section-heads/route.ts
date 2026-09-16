import { and, eq } from 'drizzle-orm';

import { sectionHeadCoordinators } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { listChainSetup } from '@/lib/approval-chain';
import { effectiveBranchIds, readBranchParam, resolveBranchScope } from '@/lib/branch-scope';
import { batch, db } from '@/lib/drizzle';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/chain/section-heads — the reporting line, Sprint 33b.
 *
 * GET the chain of command as it stands, plus the duplicate-head report
 * PUT set the coordinators one section head runs
 *
 * ── Shaped on Sprint 32's coordinator assignment, deliberately ───────────
 * `PUT /api/school/kpis/coordinators` does the same job one rung lower and
 * this is the same shape: name the supervisor, send the whole list, and the
 * subset in the caller's reach is replaced. Anyone learning one has learnt the
 * other, and the two tables they write are the two halves of one chain.
 *
 * ── Both ends must be at the same campus ─────────────────────────────────
 * A reporting line crosses no campus boundary. The section head must have one,
 * and every coordinator named must share it — otherwise the leave of somebody
 * at another campus would route to a head who cannot see them, which is the
 * exact hole Part A closed on the decision endpoint.
 *
 * ── Gated on `leave.manage` ──────────────────────────────────────────────
 * A judgement call, and it is stated rather than buried: the chain is what
 * decides who approves whose leave, so it is kept by the people who keep the
 * leave rules — HR and the School Administrator. `leave.approve` would have let
 * every coordinator in the school edit the line above themselves.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const scope = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));

      return apiSuccess({
        setup: await listChainSetup(auth.locationId, effectiveBranchIds(scope)),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.read' },
);

interface AssignBody {
  sectionHeadUserId?: unknown;
  coordinatorUserIds?: unknown;
}

export const PUT = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<AssignBody>(request);
      if (body === null || !isUuid(body.sectionHeadUserId) || !Array.isArray(body.coordinatorUserIds)) {
        return apiFailure('invalid_body', 'Choose a section head and their coordinators.', 400);
      }

      const wanted = [...new Set(body.coordinatorUserIds)];
      if (!wanted.every((id): id is string => isUuid(id))) {
        return apiFailure('invalid_body', 'One of those coordinators is not valid.', 400);
      }

      const scope = await resolveBranchScope(auth.locationId, auth);
      const branchIds = effectiveBranchIds(scope);
      const setup = await listChainSetup(auth.locationId, branchIds);

      const head = setup.sectionHeads.find((row) => row.userId === body.sectionHeadUserId);
      if (head === undefined) {
        return apiFailure('not_found', 'That section head is not in your reach.', 404);
      }

      if (head.branchId === null) {
        return apiFailure(
          'invalid_body',
          `${head.name} is not assigned to a campus yet. Set their campus in Users & Staff first — a reporting line belongs to a campus.`,
          400,
        );
      }

      const reachable = new Map(setup.coordinators.map((row) => [row.userId, row]));
      const refused = wanted.filter((id) => reachable.get(id)?.branchId !== head.branchId);

      if (refused.length > 0) {
        const name = reachable.get(refused[0] ?? '')?.name ?? 'One of those coordinators';
        return apiFailure(
          'forbidden',
          `${name} is not a coordinator at ${head.branchName ?? 'that campus'}.`,
          403,
        );
      }

      const assignedBy = await schoolUserIdForUid(auth.locationId, auth.uid);

      /*
       * Replace this head's links in one transaction, on `tx`.
       *
       * A builder made from `db` runs outside the transaction even when it is
       * awaited inside one — `lib/drizzle.ts` says so at length — so both
       * statements are built on the handle `batch` hands over. Without that a
       * failed insert would leave the head with nobody assigned rather than
       * with what they had.
       */
      await batch(db, (tx) => [
        tx
          .delete(sectionHeadCoordinators)
          .where(
            and(
              eq(sectionHeadCoordinators.locationId, auth.locationId),
              eq(sectionHeadCoordinators.sectionHeadUserId, head.userId),
            ),
          ),
        ...(wanted.length === 0
          ? []
          : [
              tx
                .insert(sectionHeadCoordinators)
                .values(
                  wanted.map((coordinatorUserId) => ({
                    locationId: auth.locationId,
                    sectionHeadUserId: head.userId,
                    coordinatorUserId,
                    branchId: head.branchId as string,
                    assignedBy,
                  })),
                )
                .onConflictDoNothing(),
            ]),
      ]);

      return apiSuccess({ setup: await listChainSetup(auth.locationId, branchIds) });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.manage' },
);
