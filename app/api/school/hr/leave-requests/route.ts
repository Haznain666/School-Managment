import { isLeaveStatus, leaveRequests } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { db } from '@/lib/drizzle';
import { getLeaveType, getStaff, listLeaveRequests } from '@/lib/hr-queries';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';
import { HR_READ_ROLES, HR_WRITE_ROLES } from '@/types/school-auth';

/**
 * /api/school/hr/leave-requests
 *
 * GET  applications, newest first
 * POST file one
 *
 * ── On `totalDays` ───────────────────────────────────────────────────────
 * The number of days consumed is submitted rather than derived from the date
 * range, because half days exist: a teacher taking the morning off consumes
 * 0.5 of their casual leave, and a range of one calendar day cannot say that.
 * It is bounded by the calendar span so the figure cannot claim more days than
 * the request actually covers — that would dock a payslip for time nobody took.
 *
 * A request is created `pending`. Nothing here can approve one; that is the
 * PATCH route, and keeping the two apart is what stops a self-filed
 * application from also being its own approval.
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
  { allowedRoles: HR_READ_ROLES },
);

interface CreateLeaveRequestBody {
  staffId?: unknown;
  leaveTypeId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  totalDays?: unknown;
  reason?: unknown;
}

/** Calendar days in an inclusive ISO date range. */
function calendarSpan(start: string, end: string): number {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateLeaveRequestBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const staffId = readOptionalString(body.staffId);
      if (staffId === null || !isUuid(staffId)) {
        return apiFailure('invalid_body', 'Choose a staff member.', 400);
      }

      // Existence *and* tenancy in one check — `getStaff` filters on location.
      const member = await getStaff(auth.locationId, staffId);
      if (member === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      const leaveTypeId = readOptionalString(body.leaveTypeId);
      if (leaveTypeId === null || !isUuid(leaveTypeId)) {
        return apiFailure('invalid_body', 'Choose a leave type.', 400);
      }

      const leaveType = await getLeaveType(auth.locationId, leaveTypeId);
      if (leaveType === null) {
        return apiFailure('not_found', 'Leave type not found.', 404);
      }

      const startDate = readOptionalString(body.startDate);
      const endDate = readOptionalString(body.endDate);

      if (startDate === null || !isIsoDate(startDate)) {
        return apiFailure('invalid_body', 'Enter a valid start date.', 400);
      }

      if (endDate === null || !isIsoDate(endDate)) {
        return apiFailure('invalid_body', 'Enter a valid end date.', 400);
      }

      if (endDate < startDate) {
        return apiFailure('invalid_body', 'The end date is before the start date.', 400);
      }

      const span = calendarSpan(startDate, endDate);

      const totalDays = Number(body.totalDays ?? span);
      if (!Number.isFinite(totalDays) || totalDays <= 0) {
        return apiFailure('invalid_body', 'Enter how many days this leave uses.', 400);
      }

      if (totalDays > span) {
        return apiFailure(
          'invalid_body',
          `This range covers ${span} day${span === 1 ? '' : 's'}, so it cannot use ${totalDays}.`,
          400,
        );
      }

      // Half-day granularity, matching what payroll can dock.
      const days = Math.round(totalDays * 2) / 2;
      if (days <= 0) {
        return apiFailure('invalid_body', 'Leave must be at least half a day.', 400);
      }

      const created = await db
        .insert(leaveRequests)
        .values({
          // Tenant comes from the verified session, never from the body.
          locationId: auth.locationId,
          staffId,
          leaveTypeId,
          startDate,
          endDate,
          totalDays: days.toFixed(1),
          reason: readOptionalString(body.reason),
          status: 'pending',
        })
        .returning({ id: leaveRequests.id });

      if (created[0] === undefined) {
        return apiFailure('internal_error', 'Could not file the leave request.', 500);
      }

      return apiSuccess({ leaveRequestId: created[0].id }, 201);
    } catch (error) {
      return handleApiError(error);
    }
  },
  { allowedRoles: HR_WRITE_ROLES },
);
