import { and, eq } from 'drizzle-orm';

import { leaveRequests, schoolUsers } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getLeaveRequest } from '@/lib/hr-queries';
import { isUuid, readOptionalString, readString } from '@/lib/validation';

/**
 * /api/school/hr/leave-requests/[requestId]
 *
 * GET   one application
 * PATCH decide it — approve, reject or cancel
 *
 * ── On the transitions ───────────────────────────────────────────────────
 * Only a `pending` request may be decided, and a decision is final. Payroll
 * reads approved unpaid leave when it computes a month, so flipping an
 * approval after that month has been run would leave a payslip that no longer
 * matches the leave behind it. A decision made in error is corrected by filing
 * a fresh request, which leaves both visible.
 *
 * `decidedBy` records who signed it off, resolved from the caller's Firebase
 * uid. A leave dispute is exactly the case where "who approved this?" has to
 * have an answer.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ requestId: string }> };

const DECISIONS = ['approved', 'rejected', 'cancelled'] as const;
type Decision = (typeof DECISIONS)[number];

function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

export const GET = withSchoolAuth<RouteContext>(
  async (_request, auth, context) => {
    try {
      const { requestId } = await context.params;
      if (!isUuid(requestId)) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      const leaveRequest = await getLeaveRequest(auth.locationId, requestId);
      if (leaveRequest === null) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      return apiSuccess({ leaveRequest });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);

interface DecideLeaveBody {
  status?: unknown;
  decisionNote?: unknown;
}

export const PATCH = withSchoolAuth<RouteContext>(
  async (request, auth, context) => {
    try {
      const { requestId } = await context.params;
      if (!isUuid(requestId)) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      const existing = await getLeaveRequest(auth.locationId, requestId);
      if (existing === null) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      if (existing.status !== 'pending') {
        return apiFailure(
          'invalid_state',
          `This request has already been ${existing.status}. File a new one instead.`,
          409,
        );
      }

      const body = await readJsonBody<DecideLeaveBody>(request);
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

      const note = readString(body.decisionNote);
      if (body.status === 'rejected' && note === '') {
        return apiFailure(
          'invalid_body',
          'Say why the request is being rejected — the staff member will see it.',
          400,
        );
      }

      // Who decided, resolved from the verified uid rather than the body.
      const deciders = await db
        .select({ id: schoolUsers.id })
        .from(schoolUsers)
        .where(
          and(
            eq(schoolUsers.locationId, auth.locationId),
            eq(schoolUsers.authUserId, auth.uid),
          ),
        )
        .limit(1);

      const updated = await db
        .update(leaveRequests)
        .set({
          status: body.status,
          decidedBy: deciders[0]?.id ?? null,
          decidedAt: new Date(),
          decisionNote: readOptionalString(body.decisionNote),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(leaveRequests.id, requestId),
            eq(leaveRequests.locationId, auth.locationId),
            // Re-checked in SQL so two administrators deciding at the same
            // moment cannot both write; the second matches no rows.
            eq(leaveRequests.status, 'pending'),
          ),
        )
        .returning({ id: leaveRequests.id });

      if (updated[0] === undefined) {
        return apiFailure(
          'invalid_state',
          'This request was decided by someone else a moment ago.',
          409,
        );
      }

      return apiSuccess({
        leaveRequest: await getLeaveRequest(auth.locationId, requestId),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.write' },
);
