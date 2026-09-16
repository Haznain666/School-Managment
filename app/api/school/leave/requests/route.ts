import { isLeaveStatus, leaveRequests } from '@/db/schema';
import { withSchoolAuth } from '@/lib/api-auth';
import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { effectiveBranchIds, readBranchParam, resolveBranchScope } from '@/lib/branch-scope';
import { db } from '@/lib/drizzle';
import { getLeaveType } from '@/lib/hr-queries';
import {
  getLeaveApplicant,
  holidaySpanFor,
  leaveSpansFor,
  listApprovalInbox,
  listLeaveForSchool,
  listOwnLeaveRequests,
  quotasFor,
} from '@/lib/leave-queries';
import {
  countLeaveDays,
  holidayProblem,
  overlapProblem,
  quotaProblem,
  roundToHalf,
  spanProblem,
} from '@/lib/leave-quota';
import { hasPermission } from '@/lib/permission-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';
import { staffHolidayDates } from '@/lib/staff-calendar-queries';
import { isIsoDate, isUuid, readOptionalString } from '@/lib/validation';

/**
 * /api/school/leave/requests — Sprint 33b.
 *
 * GET  the requests this caller may act on
 * POST apply for leave, or file it for somebody who cannot
 *
 * ── Three audiences, one endpoint, and the scope says which ──────────────
 *   · `?scope=mine`  — my own record. Everybody with `leave.request`.
 *   · `?scope=inbox` — the people who report to me, resolved through
 *     `lib/approval-chain.ts`. Needs `leave.read`; the chain, not the key,
 *     decides *whose*.
 *   · `?scope=all`   — the whole school's, campus-scoped. HR's screen, and it
 *     needs `leave.manage`.
 *
 * The route is gated on `leave.request` — the key every staff role holds — and
 * the two wider scopes are re-checked inside. That is the same shape
 * `POST /api/school/hr/staff` uses for its second key, and it is what lets a
 * teacher and a principal open the same screen and be answered differently
 * rather than one of them meeting a 403 on a page that had a link to it.
 *
 * ── Why this is not an addition to `/api/school/hr/leave-requests` ───────
 * That route is HR's and is gated on `hr.read` / `hr.write`. Part A's QA proved
 * what that costs: a Branch Admin holds neither and was refused at the
 * permission gate before the campus guard it was written for could run.
 * Widening it would have handed a campus office the whole HR module, so leave
 * has its own four keys and its own endpoint, and the HR one is untouched.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (request, auth) => {
    try {
      const url = new URL(request.url);
      const scope = url.searchParams.get('scope') ?? 'inbox';
      const statusParam = url.searchParams.get('status');
      const status = isLeaveStatus(statusParam) ? statusParam : undefined;

      if (scope === 'mine') {
        const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
        const staffId =
          schoolUserId === null
            ? null
            : await staffIdForSchoolUser(auth.locationId, schoolUserId);

        return apiSuccess({
          scope: 'mine',
          // A person with no employment record is a real state — portal
          // accounts and HR records are made by different people at different
          // times — so it is an empty list and a sentence on screen, never an
          // error.
          leaveRequests: staffId === null ? [] : await listOwnLeaveRequests(auth.locationId, staffId),
        });
      }

      const scopeForBranch = await resolveBranchScope(auth.locationId, auth, readBranchParam(url));
      const branchIds = effectiveBranchIds(scopeForBranch);

      if (scope === 'all') {
        if (!(await hasPermission(auth.locationId, auth.role, 'leave.manage'))) {
          return apiFailure(
            'forbidden',
            'Only somebody who manages leave can see every request. Your own queue is on the approvals tab.',
            403,
          );
        }

        return apiSuccess({
          scope: 'all',
          leaveRequests: await listLeaveForSchool(auth.locationId, { status, branchIds }),
        });
      }

      if (!(await hasPermission(auth.locationId, auth.role, 'leave.read'))) {
        return apiFailure('forbidden', 'Your role does not decide leave.', 403);
      }

      const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
      const inbox = await listApprovalInbox(
        auth.locationId,
        { schoolUserId, role: auth.role },
        { status, branchIds },
      );

      return apiSuccess({ scope: 'inbox', ...inbox });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.request' },
);

interface CreateLeaveBody {
  /** Absent = my own. Present and somebody else's = HR filing for them. */
  staffId?: unknown;
  leaveTypeId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  /** A half day. Never larger than what the dates count to. */
  totalDays?: unknown;
  reason?: unknown;
}

export const POST = withSchoolAuth(
  async (request, auth) => {
    try {
      const body = await readJsonBody<CreateLeaveBody>(request);
      if (body === null) {
        return apiFailure('invalid_body', 'Expected a JSON body.', 400);
      }

      const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
      const ownStaffId =
        schoolUserId === null ? null : await staffIdForSchoolUser(auth.locationId, schoolUserId);

      const requested = readOptionalString(body.staffId);
      if (requested !== null && !isUuid(requested)) {
        return apiFailure('invalid_body', 'Choose a staff member.', 400);
      }

      const staffId = requested ?? ownStaffId;
      if (staffId === null) {
        return apiFailure(
          'no_staff_record',
          'Leave is recorded against an HR staff record and your account is not linked to one yet. Ask the school office to link it.',
          409,
        );
      }

      /*
       * Filing for somebody else is a different act, and it is HR's.
       *
       * Decision 6: a junior teacher has no login, so HR files for them and it
       * still travels up the chain. That is `leave.manage` — not `leave.approve`,
       * which is the other end of the same request and belongs to somebody
       * else. A person filing and approving their own filing is the control
       * `payroll.approve` and `accounting.settle` both exist to draw.
       */
      const onBehalf = staffId !== ownStaffId;
      if (onBehalf && !(await hasPermission(auth.locationId, auth.role, 'leave.manage'))) {
        return apiFailure(
          'forbidden',
          'Only somebody who manages leave can file a request for another member of staff.',
          403,
        );
      }

      const applicant = await getLeaveApplicant(auth.locationId, staffId);
      if (applicant === null) {
        return apiFailure('not_found', 'Staff member not found.', 404);
      }

      // The campus, on the write. Sprint 33a shipped this guard on the
      // decision; filing has the same hole and the same answer.
      if (
        onBehalf &&
        auth.branchId !== null &&
        applicant.branchId !== null &&
        applicant.branchId !== auth.branchId
      ) {
        return apiFailure(
          'wrong_campus',
          'That member of staff belongs to another campus. Somebody at that campus files their leave.',
          403,
        );
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
      if (startDate === null || !isIsoDate(startDate) || endDate === null || !isIsoDate(endDate)) {
        return apiFailure('invalid_body', 'Enter a valid start and end date.', 400);
      }

      const rangeProblem = spanProblem(startDate, endDate);
      if (rangeProblem !== null) return apiFailure('invalid_body', rangeProblem, 400);

      // Their own calendar, not the raw holiday list: a holiday HR has
      // cancelled for teaching staff is a working day for them.
      const [holidays, span, spans] = await Promise.all([
        staffHolidayDates(auth.locationId, {
          branchId: applicant.branchId,
          role: applicant.role,
          from: startDate,
          to: endDate,
        }),
        holidaySpanFor(auth.locationId, applicant.branchId),
        leaveSpansFor(auth.locationId, staffId),
      ]);

      const onHoliday = holidayProblem(startDate, endDate, holidays.dates, (date) =>
        holidays.nameFor.get(date) ?? null,
      );
      if (onHoliday !== null) return apiFailure('school_closed', onHoliday, 422);

      const clash = overlapProblem(startDate, endDate, spans);
      if (clash !== null) return apiFailure('overlaps', clash, 409);

      const counted = countLeaveDays(startDate, endDate, holidays.dates, span);
      if (counted.days <= 0) {
        return apiFailure(
          'school_closed',
          'Every day in that range is one the school is already closed to them.',
          422,
        );
      }

      /*
       * The typed figure is honoured only downwards, which is what makes a half
       * day possible without letting anybody claim a fortnight for a Tuesday.
       */
      const typed = Number(body.totalDays ?? counted.days);
      const days = roundToHalf(
        Number.isFinite(typed) && typed > 0 && typed <= counted.days ? typed : counted.days,
      );

      if (days <= 0) {
        return apiFailure('invalid_body', 'Leave must be at least half a day.', 400);
      }

      const { quotas } = await quotasFor(auth.locationId, applicant);
      const quota = quotas.find((row) => row.leaveTypeId === leaveTypeId);
      if (quota !== undefined) {
        const overspent = quotaProblem(quota, days, quota.leaveTypeName);
        if (overspent !== null) return apiFailure('no_entitlement', overspent, 422);
      }

      const created = await db
        .insert(leaveRequests)
        .values({
          // Tenant from the verified session, never from the body.
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

      return apiSuccess(
        {
          leaveRequestId: created[0].id,
          counted: { days, holidayDays: counted.holidayDays, skipped: counted.skipped },
        },
        201,
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.request' },
);
