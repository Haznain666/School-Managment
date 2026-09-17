import { isLeaveStatus } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError } from '@/lib/api-response';
import { listLeaveRequests } from '@/lib/hr-queries';
import { isUuid } from '@/lib/validation';

/**
 * /api/school/hr/leave-requests
 *
 * GET  applications, newest first
 * POST retired — refuses with 410 and points at /api/school/leave/requests
 *
 * ── Only the read is left ────────────────────────────────────────────────
 * The GET stays as a campus-scoped read on `hr.read` for anything that still
 * wants it; nothing in the product calls it since Sprint 33b's QA round 1, when
 * the HR leave screen moved to `/api/school/leave/requests?scope=all`. Filing
 * lives there too, with the half-day rule, the holiday and overlap refusals,
 * the quota and the campus guard — see the POST below for why this door shut.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const statusParam = url.searchParams.get('status');
      const staffParam = url.searchParams.get('staffId');

      return apiSuccess({
        leaveRequests: await listLeaveRequests(auth.locationId, {
          status: isLeaveStatus(statusParam) ? statusParam : undefined,
          staffId: staffParam !== null && isUuid(staffParam) ? staffParam : undefined,
          // A branch admin sees their own branch's applications only.
          branchId: auth.branchId ?? undefined,
        }),
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'hr.read' },
);


/**
 * POST — retired in Sprint 33b, QA round 1 (F1). It refuses, and says where to go.
 *
 * This route filed leave checking only `hr.write`, so QA filed a single-day request on
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
export const POST = withSchoolAuth(
  async () =>
    apiFailure(
      'moved',
      'Leave is filed through /api/school/leave/requests now, which applies the holiday, overlap, quota and campus checks. Use the Leave screen, or POST there with staffId.',
      410,
    ),
  { permission: 'hr.write' },
);
