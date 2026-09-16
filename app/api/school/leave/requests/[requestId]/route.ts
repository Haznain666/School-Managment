import { and, eq } from 'drizzle-orm';

import { leaveRequests } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { db } from '@/lib/drizzle';
import { getLeaveApplicant, listOwnLeaveRequests } from '@/lib/leave-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';
import { isUuid } from '@/lib/validation';

/**
 * DELETE /api/school/leave/requests/[requestId] — withdrawing your own.
 *
 * ── Why this is not the decision endpoint with a different word ──────────
 * Cancelling somebody else's request is a *decision* and needs `leave.approve`.
 * Withdrawing your own is not a decision about anybody: it is taking back a
 * question you asked, and every member of staff who can ask it can take it
 * back. `leave.request` is therefore the key, and the route refuses anything
 * that is not the caller's own pending request rather than checking a chain.
 *
 * It matters because the overlap refusal tells people to do exactly this —
 * *"Withdraw that request first, or choose other dates"* — and a sentence that
 * names an action nothing offers is the orphaned-endpoint problem the other way
 * round.
 *
 * The row is **kept** and moved to `cancelled`, never deleted. "She applied for
 * Eid week and withdrew it" is a fact a school may have to explain.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ requestId: string }> };

export const DELETE = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { requestId } = await context.params;
      if (!isUuid(requestId)) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
      const staffId =
        schoolUserId === null ? null : await staffIdForSchoolUser(auth.locationId, schoolUserId);

      if (staffId === null) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      /*
       * Ownership is in the `WHERE`, not in an `if` above it.
       *
       * The tenant, the staff record and the pending state are all conditions
       * on the one statement, so a request belonging to somebody else matches
       * no rows and is answered 404 — the same answer an id that does not exist
       * gets. There is nothing here that learns whether another person's
       * request exists.
       */
      const cancelled = await db
        .update(leaveRequests)
        .set({ status: 'cancelled', decidedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(leaveRequests.locationId, auth.locationId),
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.staffId, staffId),
            eq(leaveRequests.status, 'pending'),
          ),
        )
        .returning({ id: leaveRequests.id });

      if (cancelled[0] === undefined) {
        return apiFailure(
          'invalid_state',
          'That request is not yours, or it has already been decided.',
          409,
        );
      }

      // Returned so the screen redraws from the server rather than guessing.
      const applicant = await getLeaveApplicant(auth.locationId, staffId);

      return apiSuccess({
        leaveRequests: await listOwnLeaveRequests(auth.locationId, staffId),
        staffName: applicant?.name ?? null,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.request' },
);
