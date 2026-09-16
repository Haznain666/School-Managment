import { withSchoolAuth } from '@/lib/api-auth';
import { apiSuccess, handleApiError } from '@/lib/api-response';
import { schoolUserIdForUid } from '@/lib/accounting-queries';
import { chainSummary, loadChainIndex, resolveChain } from '@/lib/approval-chain';
import {
  getLeaveApplicant,
  holidaySpanFor,
  listOwnLeaveRequests,
  quotasFor,
} from '@/lib/leave-queries';
import { staffIdForSchoolUser } from '@/lib/staff-self-queries';

/**
 * GET /api/school/leave/me — everything the self-service form needs, at once.
 *
 * The leave heads with **this person's** remaining days against each, their own
 * requests, the campus's holiday rule, and the chain their application will
 * travel up, said in words.
 *
 * ── One request, because the form is one screen ──────────────────────────
 * The alternative is four: types, quota, history, and the chain. A teacher
 * opening this on a phone in Lahore pays ~1s for each of them against the live
 * origin, and the form cannot draw until the slowest lands.
 *
 * ── Saying who decides it is the point, not a courtesy ───────────────────
 * The one question a teacher asks after pressing the button is *"who has it
 * now?"*. Before this sprint the honest answer was "the office", because
 * nothing recorded a reporting line. `chainSummary` is that answer, and it is
 * the same resolver the decision endpoint enforces — so what the screen
 * promises and what the server allows cannot drift.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withSchoolAuth(
  async (_request, auth) => {
    try {
      const schoolUserId = await schoolUserIdForUid(auth.locationId, auth.uid);
      const staffId =
        schoolUserId === null ? null : await staffIdForSchoolUser(auth.locationId, schoolUserId);

      if (staffId === null) {
        /*
         * A portal account with no employment record behind it.
         *
         * Real, ordinary, and not an error: accounts and HR records are created
         * by different people at different times, and a teacher may be teaching
         * for weeks before HR enters them. The screen says so and says what to
         * do about it, which is actionable; a 404 is not.
         */
        return apiSuccess({
          staff: null,
          quotas: [],
          leaveRequests: [],
          chain: null,
          holidaySpan: 'include',
        });
      }

      const applicant = await getLeaveApplicant(auth.locationId, staffId);
      if (applicant === null) {
        return apiSuccess({
          staff: null,
          quotas: [],
          leaveRequests: [],
          chain: null,
          holidaySpan: 'include',
        });
      }

      const [{ quotas, year }, requests, span, index] = await Promise.all([
        quotasFor(auth.locationId, applicant),
        listOwnLeaveRequests(auth.locationId, staffId),
        holidaySpanFor(auth.locationId, applicant.branchId),
        loadChainIndex(auth.locationId),
      ]);

      return apiSuccess({
        staff: {
          staffId: applicant.staffId,
          name: applicant.name,
          employeeCode: applicant.employeeCode,
          designation: applicant.designation,
          branchName: applicant.branchName,
          permanentFrom: applicant.permanentFrom,
        },
        year: year === null ? null : { start: year.startYear, end: year.endYear },
        quotas,
        leaveRequests: requests,
        chain: chainSummary(resolveChain(index, applicant)),
        holidaySpan: span,
      });
    } catch (error) {
      return handleApiError(error);
    }
  },
  { permission: 'leave.request' },
);
