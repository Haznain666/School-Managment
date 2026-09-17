import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { getLeaveRequest } from '@/lib/hr-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/hr/leave-requests/[requestId]
 *
 * GET   one application
 * PATCH retired — refuses with 410; decisions go to /api/school/leave/requests/[id]/decision
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

/**
 * Whether this request is outside the caller's campus.
 *
 * `auth.branchId === null` is school-wide access and sees everything, which is
 * the same rule the list applies with `branchId: auth.branchId ?? undefined`.
 * A staff member with no campus of their own belongs to the school rather than
 * to a campus, so a campus-bound approver does not own them either.
 */
function outsideCampus(callerBranchId: string | null, staffBranchId: string | null): boolean {
  return callerBranchId !== null && staffBranchId !== callerBranchId;
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

      // 404 rather than 403 on the read: whether another campus has a request
      // with this id is not something a campus-bound reader should learn, and
      // the list they came from never showed it to them.
      if (outsideCampus(auth.branchId, leaveRequest.branchId)) {
        return apiFailure('not_found', 'Leave request not found.', 404);
      }

      return apiSuccess({ leaveRequest });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);


/**
 * PATCH — retired in Sprint 33b, QA round 1 (F1). It refuses, and says where to go.
 *
 * This route decided leave checking only `hr.write`, so QA filed a single-day request on
 * Iqbal Day (201 here, 422 on the new route), filed for another campus's staff
 * past the `wrong_campus` refusal, and had HR decide a request HR holds no
 * `leave.approve` for. Every rule Part B added — the holiday refusals, the
 * overlap and quota checks, the campus guard and the approval chain — lives on
 * `/api/school/leave/requests`, and a second door that skips them makes all of
 * them advisory.
 *
 * It refuses rather than disappears so anything still calling it gets a
 * sentence instead of a 404. Nothing in the product does: `LeaveManager` was
 * the only caller and now files through the new route. Payroll never used it —
 * it reads `leave_requests` directly through `unpaidLeaveDaysByStaff`, which
 * is unchanged.
 */
export const PATCH = withSchoolAuth<RouteContext>(
  async () =>
    apiFailure(
      'moved',
      'Leave is decided through /api/school/leave/requests/[id]/decision now, by somebody in the approval chain who holds leave.approve. HR files and manages leave but does not decide it.',
      410,
    ),
  { permission: 'hr.write' },
);
