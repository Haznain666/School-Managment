import { and, eq } from 'drizzle-orm';

import { leaveRequests } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { chainSummary, decisionRefusal, resolveChain } from '@/lib/approval-chain';
import { db } from '@/lib/drizzle';
import { getLeaveForDecision } from '@/lib/leave-queries';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * POST /api/school/leave/requests/[requestId]/decision — Sprint 33b.
 *
 * Approve, reject or cancel one request.
 *
 * ── Three gates, in this order, and none of them is the other ────────────
 *   1. **`leave.approve`**, by the wrapper. May this role decide leave at all.
 *   2. **The campus**, kept exactly as Sprint 33a shipped it. A campus-bound
 *      approver cannot decide another campus's request, and the refusal is a
 *      403 they can read rather than a 404 — somebody addressing this endpoint
 *      already holds the id.
 *   3. **The chain**, resolved again *here*. `listApprovalInbox` resolves it
 *      too, and that is a **visibility** boundary: it decides what is drawn. A
 *      stale tab, a pasted id, or a reassignment between the page rendering and
 *      the button being pressed all arrive here looking legitimate.
 *      `lib/principal-resolver.ts` makes the same distinction in the same
 *      words, and for a decision that costs somebody days of their entitlement
 *      it is not close.
 *
 * ── A decision is final ──────────────────────────────────────────────────
 * Only a `pending` request may be decided, and the `UPDATE` re-checks that in
 * SQL so two approvers pressing at the same moment cannot both write. Payroll
 * reads approved unpaid leave when it computes a month; flipping an approval
 * after that month has run would leave a payslip that no longer matches the
 * leave behind it. A decision made in error is corrected by a fresh request,
 * which leaves both visible.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ requestId: string }> };

const DECISIONS = ['approved', 'rejected', 'cancelled'] as const;
type Decision = (typeof DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

interface DecideBody {
  status?: unknown;
  decisionNote?: unknown;
}

export const POST = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { requestId } = await context.params;
      if (!isUuid(requestId)) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      const found = await getLeaveForDecision(auth.locationId, requestId);
      if (found === null) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      const { request: leaveRequest, applicant, index } = found;

      // Gate 2 — the campus. Sprint 33a's guard, unchanged in substance.
      if (auth.branchId !== null && applicant.branchId !== auth.branchId) {
        return apiFailure(
          'wrong_campus',
          'That request belongs to another campus. Only somebody at that campus can decide it.',
          403,
        );
      }

      // Gate 3 — the chain, on the write.
      const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
      const chain = resolveChain(index, applicant);
      const refusal = decisionRefusal(chain, { schoolUserId, role: auth.role });
      if (refusal !== null) {
        return apiFailure('not_in_chain', refusal, 403);
      }

      if (leaveRequest.status !== 'pending') {
        return apiFailure(
          'invalid_state',
          `This request has already been ${leaveRequest.status}. File a new one instead.`,
          409,
        );
      }

      const body = await readJsonBody<DecideBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      if (!isDecision(body.status)) {
        return apiFailure(
          'invalid_body',
          'Choose whether to approve, reject or cancel this request.',
          400,
        );
      }

      // A rejection a person cannot be told the grounds for is a rejection the
      // school cannot defend — the same rule `chat_grants.reason` carries.
      if (body.status === 'rejected' && readString(body.decisionNote) === '') {
        return apiFailure(
          'invalid_body',
          'Say why the request is being rejected — the staff member will see it.',
          400,
        );
      }

      const updated = await db
        .update(leaveRequests)
        .set({
          status: body.status,
          decidedBy: schoolUserId,
          decidedAt: new Date(),
          decisionNote: readOptionalString(body.decisionNote),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.locationId, auth.locationId),
            // Re-checked in SQL so two approvers deciding at the same moment
            // cannot both write; the second matches no rows.
            eq(leaveRequests.status, 'pending'),
          ),
        )
        .returning({ id: leaveRequests.id });

      if (updated[0] === undefined) {
        return apiFailure(
          'invalid_state',
          'This request was decided by somebody else a moment ago.',
          409,
        );
      }

      const after = await getLeaveForDecision(auth.locationId, requestId);

      return apiSuccess({
        leaveRequest: after?.request ?? null,
        chain: chainSummary(chain),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.approve' },
);
